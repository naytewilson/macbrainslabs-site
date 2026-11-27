#!/usr/bin/env node
// Lifecycle of the publication pull request: plans, retries, a scratch git
// remote, a pre-existing branch, overlapping candidates, and main moving.
// Dependency-free; run: node scripts/test-publications-publish-pr.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FEED_PATHS, candidateBody, executePlan, fail, isRetryable, planPublication,
  publicationBranch, pushArgs, runPublicationCli, withRetries
} from './publish-publications-pr.mjs';

let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

const MAIN_A = 'a'.repeat(40);
const MAIN_B = 'b'.repeat(40);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function bareRef(remote, ref) {
  return git(remote, ['rev-parse', ref]).trim();
}

function seed(work) {
  for (const rel of FEED_PATHS) {
    const abs = path.join(work, rel);
    if (rel.endsWith('.html')) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'base\n');
    } else {
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, 'keep.txt'), 'base\n');
    }
  }
  git(work, ['add', '--', ...FEED_PATHS]);
  git(work, ['commit', '-m', 'base']);
  git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
}

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-pr-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, ['init', '--bare', '-b', 'main', remote]);
  git(root, ['clone', remote, work]);
  git(work, ['config', 'user.email', 'publications@macbrainslabs.org']);
  git(work, ['config', 'user.name', 'publications-feed-bot']);
  seed(work);
  const state = { prs: [], calls: [], failCreate: 0, denyCreate: false };
  const io = {
    opts: { cwd: work },
    exec(file, args, opts = {}) {
      if (file === 'gh') {
        state.calls.push(args);
        if (args[0] === 'pr' && args[1] === 'list') {
          return { code: 0, stdout: `${JSON.stringify(state.prs.map(pr => ({ number: pr.number, headRefName: pr.headRef, baseRefOid: pr.baseSha })))}\n`, stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'create') {
          if (state.denyCreate) throw fail('GitHub Actions is not permitted to create or approve pull requests', { retryable: false });
          if (state.failCreate > 0) {
            state.failCreate -= 1;
            throw fail('connection reset by peer', { retryable: true });
          }
          const head = args[args.indexOf('--head') + 1];
          const baseSha = git(opts.cwd ?? work, ['rev-parse', 'HEAD^']).trim();
          const pr = { number: state.prs.reduce((max, item) => Math.max(max, item.number), 0) + 1, headRef: head, baseSha };
          state.prs.push(pr);
          return { code: 0, stdout: `https://example.test/pull/${pr.number}\n`, stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'close') {
          const number = Number(args[2]);
          state.prs = state.prs.filter(pr => pr.number !== number);
          return { code: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'api' && args.includes(`context=publications-feed/candidate`)) {
          return { code: 0, stdout: '{}\n', stderr: '' };
        }
        throw fail(`unexpected gh ${args.join(' ')}`);
      }
      try {
        const stdout = execFileSync(file, args, { cwd: opts.cwd ?? work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
      } catch (err) {
        const stderr = err.stderr?.toString?.() ?? '';
        if (opts.allowStatus && opts.allowStatus.includes(err.status)) return { code: err.status, stdout: err.stdout?.toString?.() ?? '', stderr };
        throw fail(stderr || err.message, { retryable: /connection reset/i.test(stderr) });
      }
    }
  };
  return { root, remote, work, state, io };
}

function envFor(root, runId) {
  return {
    GITHUB_RUN_ID: String(runId),
    GITHUB_REPOSITORY: 'naytewilson/macbrainslabs-site',
    GITHUB_OUTPUT: path.join(root, `out-${runId}.txt`),
    PATH: process.env.PATH
  };
}

async function publish(box, runId) {
  const env = envFor(box.root, runId);
  await runPublicationCli(['--commit-only'], env, box.io);
  await runPublicationCli(['--push'], { ...env, CANDIDATE_SHA: git(box.work, ['rev-parse', 'HEAD']).trim() }, box.io);
  return env;
}

await t('push refspec never names main', () => {
  assert.deepEqual(pushArgs('publications/recheck-41', null), ['push', 'origin', 'HEAD:refs/heads/publications/recheck-41']);
  const leased = pushArgs('publications/recheck-41', MAIN_A);
  assert.equal(leased.some(arg => arg.includes('refs/heads/main')), false);
  assert.throws(() => pushArgs('main', null), /refusing to push/);
  assert.throws(() => pushArgs('publications/recheck-41', 'deadbeef'), /refusing lease/);
  assert.throws(() => publicationBranch('41; git push origin main'), /refusing run id/);
});

await t('plan publishes one candidate and supersedes other open feed pull requests', () => {
  const plan = planPublication({
    runId: '42',
    hasDiff: true,
    currentMainSha: MAIN_B,
    openPrs: [
      { number: 7, headRef: 'publications/recheck-41', baseSha: MAIN_A },
      { number: 8, headRef: 'publications/recheck-40', baseSha: MAIN_B },
      { number: 9, headRef: 'feature/not-a-feed', baseSha: MAIN_A }
    ]
  });
  assert.deepEqual(plan.steps.map(step => step.op), ['push', 'create-pr', 'status', 'close', 'close']);
  assert.equal(plan.steps[1].branch, 'publications/recheck-42');
  assert.deepEqual(plan.steps.filter(step => step.op === 'close').map(step => step.number), [7, 8]);
  assert.match(plan.steps[3].reason, /main moved|regenerated from main b{40}/);
  assert.equal(JSON.stringify(plan).includes('refs/heads/main'), false);
});

await t('plan reuses the pull request for the same run and closes nothing of its own', () => {
  const plan = planPublication({
    runId: '41',
    hasDiff: true,
    currentMainSha: MAIN_A,
    openPrs: [{ number: 7, headRef: 'publications/recheck-41', baseSha: MAIN_A }]
  });
  assert.deepEqual(plan.steps.map(step => step.op), ['push', 'reuse-pr', 'status']);
  assert.equal(plan.steps[1].number, 7);
});

await t('plan closes a stale pull request when the fresh rebuild matches main', () => {
  const plan = planPublication({
    runId: '50',
    hasDiff: false,
    currentMainSha: MAIN_B,
    openPrs: [{ number: 7, headRef: 'publications/recheck-41', baseSha: MAIN_A }]
  });
  assert.equal(plan.action, 'no_change');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].op, 'close');
  assert.match(plan.steps[0].reason, /stale/);
});

await t('retries a transient push and refuses a permission error without pushing main', async () => {
  let pushes = 0;
  const seen = [];
  const io = {
    opts: {},
    exec(file, args) {
      seen.push([file, ...args].join(' '));
      if (args[0] === 'ls-remote') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw fail('connection reset by peer', { retryable: true });
        return { code: 0, stdout: '', stderr: '' };
      }
      throw fail(`unexpected ${file}`);
    }
  };
  const plan = planPublication({ runId: '9', hasDiff: true, currentMainSha: MAIN_A, openPrs: [] });
  plan.steps = plan.steps.filter(step => step.op === 'push');
  await executePlan(plan, { io, dryRun: false, retry: { wait: () => Promise.resolve() } });
  assert.equal(pushes, 2);
  assert.equal(seen.some(line => line.includes('refs/heads/main')), false);

  let denied = 0;
  const deny = {
    opts: {},
    exec(file, args) {
      if (args[0] === 'pr') {
        denied += 1;
        throw fail('GitHub Actions is not permitted to create or approve pull requests', { retryable: false });
      }
      throw fail(`unexpected ${file} ${args.join(' ')}`);
    }
  };
  const create = planPublication({ runId: '9', hasDiff: true, currentMainSha: MAIN_A, openPrs: [] });
  create.steps = create.steps.filter(step => step.op === 'create-pr');
  await assert.rejects(() => executePlan(create, {
    io: deny,
    dryRun: false,
    repo: 'naytewilson/macbrainslabs-site',
    title: 'publications: archive feed recheck 9',
    bodyFile: 'body.md',
    retry: { wait: () => Promise.resolve() }
  }), /not permitted/);
  assert.equal(denied, 1);
  assert.equal(isRetryable(fail('not permitted to create or approve pull requests')), false);
});

await t('candidate text rejects a sha that could break a line', () => {
  assert.throws(() => candidateBody({ sha: `${'a'.repeat(40)}\n::error::`, base: MAIN_A, runId: '1' }), /not a full sha/);
  const body = candidateBody({ sha: MAIN_A, base: MAIN_B, runId: '1' });
  assert.equal(body.includes('::'), false);
  assert.match(body, /does not approve them and does not merge/);
});

await t('withRetries stops on the first non-retryable error', async () => {
  let n = 0;
  await assert.rejects(() => withRetries(() => {
    n += 1;
    throw fail('HTTP 403', { retryable: false });
  }, { wait: () => Promise.resolve() }), /403/);
  assert.equal(n, 1);
});

await t('scratch remote: create, reuse the same run, supersede, and move main', async () => {
  const box = scratch();
  try {
    const mainBefore = bareRef(box.remote, 'refs/heads/main');
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'candidate-1\n');
    await publish(box, 41);
    const candidate = bareRef(box.remote, 'refs/heads/publications/recheck-41');
    assert.equal(bareRef(box.remote, 'refs/heads/publications/recheck-41^'), mainBefore);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainBefore);
    assert.equal(box.state.prs.length, 1);
    assert.equal(box.state.prs[0].headRef, 'publications/recheck-41');
    assert.equal(box.state.calls.filter(args => args[1] === 'create').length, 1);
    assert.equal(box.state.calls.some(args => args.join(' ').includes('refs/heads/main')), false);

    git(box.work, ['checkout', 'main']);
    git(box.work, ['reset', '--hard', 'origin/main']);
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'candidate-1b\n');
    await publish(box, 41);
    assert.notEqual(bareRef(box.remote, 'refs/heads/publications/recheck-41'), candidate);
    assert.equal(bareRef(box.remote, 'refs/heads/publications/recheck-41^'), mainBefore);
    assert.equal(box.state.prs.length, 1);
    assert.equal(box.state.calls.filter(args => args[1] === 'create').length, 1);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainBefore);

    git(box.work, ['checkout', 'main']);
    git(box.work, ['reset', '--hard', 'origin/main']);
    fs.writeFileSync(path.join(box.work, 'index.html'), 'owner moved main\n');
    git(box.work, ['add', 'index.html']);
    git(box.work, ['commit', '-m', 'owner moves main']);
    git(box.work, ['push', 'origin', 'HEAD:refs/heads/main']);
    const moved = bareRef(box.remote, 'refs/heads/main');
    assert.notEqual(moved, mainBefore);
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'candidate-2\n');
    await publish(box, 77);
    assert.equal(bareRef(box.remote, 'refs/heads/publications/recheck-77^'), moved);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), moved);
    assert.equal(box.state.prs.length, 1);
    assert.equal(box.state.prs[0].headRef, 'publications/recheck-77');
    assert.equal(box.state.calls.some(args => args[0] === 'pr' && args[1] === 'merge'), false);
    assert.equal(box.state.calls.some(args => args[0] === 'pr' && args[1] === 'review'), false);
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

await t('scratch remote: a fresh match closes the stale pull request and does not push', async () => {
  const box = scratch();
  try {
    const mainSha = bareRef(box.remote, 'refs/heads/main');
    box.state.prs.push({ number: 3, headRef: 'publications/recheck-1', baseSha: MAIN_A });
    const env = envFor(box.root, 90);
    const out = await runPublicationCli(['--no-diff'], env, box.io);
    assert.equal(out.action, 'no_change');
    assert.equal(box.state.prs.length, 0);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainSha);
    assert.throws(() => bareRef(box.remote, 'refs/heads/publications/recheck-90'));
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

await t('scratch remote: push from main is refused', async () => {
  const box = scratch();
  try {
    const mainSha = bareRef(box.remote, 'refs/heads/main');
    await assert.rejects(() => runPublicationCli(['--push'], envFor(box.root, 12), box.io), /refusing to publish from main/);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainSha);
    assert.equal(box.state.calls.some(args => args[1] === 'create'), false);
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

await t('scratch remote: transient create is retried and a permission denial is not', async () => {
  const box = scratch();
  try {
    const mainSha = bareRef(box.remote, 'refs/heads/main');
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'retry\n');
    box.state.failCreate = 2;
    await publish(box, 15);
    assert.equal(box.state.calls.filter(args => args[1] === 'create').length, 3);
    assert.equal(box.state.prs.length, 1);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainSha);

    git(box.work, ['checkout', 'main']);
    git(box.work, ['reset', '--hard', 'origin/main']);
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'denied\n');
    box.state.denyCreate = true;
    const env = envFor(box.root, 16);
    await runPublicationCli(['--commit-only'], env, box.io);
    await assert.rejects(() => runPublicationCli(['--push'], { ...env, CANDIDATE_SHA: git(box.work, ['rev-parse', 'HEAD']).trim() }, box.io), /not permitted/);
    assert.equal(box.state.calls.filter(args => args[1] === 'create' && args.includes('publications/recheck-16')).length, 1);
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainSha);
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

await t('dry-run reports the candidate and does not commit or push', async () => {
  const box = scratch();
  try {
    const mainSha = bareRef(box.remote, 'refs/heads/main');
    fs.writeFileSync(path.join(box.work, 'publications', 'keep.txt'), 'dry\n');
    const env = { ...envFor(box.root, 18), PUBLICATIONS_PUBLISH_DRY_RUN: '1' };
    const out = await runPublicationCli(['--commit-only', '--dry-run'], env, box.io);
    assert.equal(out.action, 'dry-run');
    assert.equal(git(box.work, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
    assert.equal(bareRef(box.remote, 'refs/heads/main'), mainSha);
    assert.equal(box.state.calls.length, 0);
    assert.throws(() => bareRef(box.remote, 'refs/heads/publications/recheck-18'));
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

console.log(`publication pull request tests: ${failed === 0 ? 'ok' : `${failed} failed`}`);
if (failed) process.exitCode = 1;
