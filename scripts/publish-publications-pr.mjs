#!/usr/bin/env node
// Turn a verified feed diff into one pull request. This never pushes main,
// never merges, and never approves a review. A failed rebuild never reaches it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FEED_PATHS = ['index.html', 'publications', 'research/explore', 'start', 'assets/social'];
export const STATUS_CONTEXT = 'publications-feed/candidate';

export function fail(message, { retryable = false } = {}) {
  const err = new Error(message);
  err.retryable = retryable;
  return err;
}

export function publicationBranch(runId) {
  const id = String(runId ?? '');
  if (!/^[0-9]+$/.test(id)) throw fail(`refusing run id ${JSON.stringify(id)}`);
  return `publications/recheck-${id}`;
}

export function pushArgs(branch, remoteSha) {
  if (!/^publications\/recheck-[0-9]+$/.test(branch)) throw fail(`refusing to push ${JSON.stringify(branch)}`);
  const dest = `HEAD:refs/heads/${branch}`;
  if (remoteSha == null || remoteSha === '') return ['push', 'origin', dest];
  if (!/^[0-9a-f]{40}$/.test(remoteSha)) throw fail(`refusing lease sha ${JSON.stringify(remoteSha)}`);
  return ['push', `--force-with-lease=refs/heads/${branch}:${remoteSha}`, 'origin', dest];
}

export function isRetryableMessage(text) {
  const s = String(text ?? '');
  if (/not permitted to create or approve pull requests/i.test(s)) return false;
  if (/\b(401|403|404|422)\b/.test(s)) return false;
  if (/authentication|permission denied|refusing/i.test(s)) return false;
  return /could not resolve|connection reset|timed out|network is unreachable|temporary failure|HTTP 5\d\d|the remote end hung up/i.test(s);
}

export function isRetryable(err) {
  if (!err || err.retryable === false) return false;
  if (err.retryable === true) return true;
  return isRetryableMessage(`${err.message ?? ''} ${err.stderr ?? ''}`);
}

export async function withRetries(fn, { attempts = 3, delays = [0, 200, 800], wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await wait(delays[i + 1] ?? 800);
    }
  }
  throw last;
}

function closeReason(pr, currentMainSha, successor) {
  const moved = pr.baseSha && pr.baseSha !== currentMainSha;
  if (successor) {
    return moved
      ? `superseded by ${successor} regenerated from main ${currentMainSha}`
      : `superseded by ${successor}; only one publication pull request stays open`;
  }
  return moved
    ? `stale: main moved to ${currentMainSha} and a fresh rebuild matches main`
    : 'a fresh rebuild matches main, so this pull request must not be merged';
}

export function planPublication({ runId, hasDiff, currentMainSha, openPrs }) {
  if (!/^[0-9a-f]{40}$/.test(currentMainSha ?? '')) throw fail('current main sha is not a full sha');
  const feed = (Array.isArray(openPrs) ? openPrs : []).filter(pr => pr && typeof pr.headRef === 'string' && /^publications\/recheck-[0-9]+$/.test(pr.headRef) && Number.isInteger(pr.number));
  if (!hasDiff) {
    return {
      action: 'no_change',
      branch: null,
      steps: feed.map(pr => ({ op: 'close', number: pr.number, reason: closeReason(pr, currentMainSha, null) }))
    };
  }
  const branch = publicationBranch(runId);
  const own = feed.filter(pr => pr.headRef === branch);
  const others = feed.filter(pr => pr.headRef !== branch);
  const steps = [
    { op: 'push', branch },
    own.length ? { op: 'reuse-pr', number: own[0].number, branch } : { op: 'create-pr', branch },
    { op: 'status', branch, context: STATUS_CONTEXT },
    ...others.map(pr => ({ op: 'close', number: pr.number, reason: closeReason(pr, currentMainSha, branch) }))
  ];
  return { action: 'publish', branch, steps };
}

function assertSha(value, what) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) throw fail(`${what} is not a full sha`);
  return value;
}

function safeRepo(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? '')) throw fail('GITHUB_REPOSITORY is not owner/name');
  return value;
}

export function candidateBody({ sha, base, runId }) {
  assertSha(sha, 'candidate');
  assertSha(base, 'base');
  publicationBranch(runId);
  return [
    `Candidate \`${sha}\` was checked on this runner before it was pushed.`,
    `Base \`${base}\`.`,
    '',
    'GitHub opens the site-check and visual QA workflows for this pull request in an approval-required state when GITHUB_TOKEN creates it. A person with write access has to choose Approve workflows to run before those checks execute on this head. This workflow does not approve them and does not merge.',
    '',
    'The previous public snapshot stays on main until this pull request is merged.',
    ''
  ].join('\n');
}

function defaultExec(file, args, { cwd, env, allowStatus } = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? '';
    const stdout = err.stdout?.toString?.() ?? '';
    if (allowStatus && allowStatus.includes(err.status)) return { code: err.status, stdout, stderr };
    const wrapped = fail(`${file} ${args.join(' ')} failed (${err.status ?? 'signal'}): ${stderr || err.message}`, {
      retryable: isRetryableMessage(`${stderr} ${err.message}`)
    });
    wrapped.stderr = stderr;
    wrapped.stdout = stdout;
    throw wrapped;
  }
}

function gitText(io, args) {
  return io.exec('git', args, io.opts).stdout.trim();
}

function pendingDiff(io) {
  const { stdout } = io.exec('git', ['status', '--porcelain', '--', ...FEED_PATHS], io.opts);
  return stdout.trim().length > 0;
}

function remoteBranchSha(io, branch) {
  publicationBranch(branch.slice('publications/recheck-'.length));
  const { stdout } = io.exec('git', ['ls-remote', 'origin', `refs/heads/${branch}`], io.opts);
  const line = stdout.trim().split('\n').find(Boolean) ?? '';
  if (!line) return null;
  const sha = line.split(/\s+/u)[0];
  return assertSha(sha, 'ls-remote');
}

function listFeedPrs(io) {
  const { stdout } = io.exec('gh', ['pr', 'list', '--state', 'open', '--base', 'main', '--limit', '100', '--json', 'number,headRefName,baseRefOid'], io.opts);
  const rows = JSON.parse(stdout || '[]');
  if (!Array.isArray(rows)) throw fail('gh pr list did not return a list');
  return rows.map(row => ({ number: row.number, headRef: row.headRefName, baseSha: row.baseRefOid }));
}

function setOutput(env, name, value) {
  if (!env.GITHUB_OUTPUT) return;
  if (!/^[a-z_]+$/.test(name)) throw fail('bad output name');
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes('..') || value.includes('::')) throw fail('bad output value');
  fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export async function executePlan(plan, ctx) {
  const commands = [];
  for (const step of plan.steps) {
    if (step.op === 'push') {
      await withRetries(() => {
        const remoteSha = remoteBranchSha(ctx.io, step.branch);
        const args = pushArgs(step.branch, remoteSha);
        commands.push(['git', ...args]);
        if (!ctx.dryRun) ctx.io.exec('git', args, ctx.io.opts);
      }, ctx.retry ?? {});
    } else if (step.op === 'create-pr') {
      const args = ['pr', 'create', '--base', 'main', '--head', step.branch, '--title', ctx.title, '--body-file', ctx.bodyFile];
      commands.push(['gh', ...args]);
      if (!ctx.dryRun) await withRetries(() => ctx.io.exec('gh', args, ctx.io.opts), ctx.retry ?? {});
    } else if (step.op === 'reuse-pr') {
      commands.push(['reuse-pr', String(step.number)]);
    } else if (step.op === 'status') {
      const args = ['api', '--method', 'POST', `repos/${ctx.repo}/statuses/${ctx.sha}`, '-f', 'state=success', '-f', `context=${STATUS_CONTEXT}`, '-f', 'description=candidate checks passed before the pull request was opened'];
      commands.push(['gh', ...args]);
      if (!ctx.dryRun) await withRetries(() => ctx.io.exec('gh', args, ctx.io.opts), ctx.retry ?? {});
    } else if (step.op === 'close') {
      const comment = `Publication feed run ${ctx.runId}: ${step.reason}. This workflow does not push main.`;
      if (/[\r\n\u2028\u2029]/.test(comment) || comment.includes('::')) throw fail('refusing to post an unsafe close comment');
      const args = ['pr', 'close', String(step.number), '--comment', comment];
      commands.push(['gh', ...args]);
      if (!ctx.dryRun) await withRetries(() => ctx.io.exec('gh', args, ctx.io.opts), ctx.retry ?? {});
    } else {
      throw fail(`unknown publication step ${step.op}`);
    }
  }
  return commands;
}

export async function runPublicationCli(argv, env = process.env, io = { exec: defaultExec, opts: { cwd: process.cwd(), env } }) {
  const dryRun = argv.includes('--dry-run') || env.PUBLICATIONS_PUBLISH_DRY_RUN === '1';
  const mode = argv.includes('--push') ? 'push' : argv.includes('--no-diff') ? 'no-diff' : argv.includes('--commit-only') ? 'commit-only' : (dryRun ? 'commit-only' : null);
  if (!mode) throw fail('pass --commit-only, --push, --no-diff, or --dry-run');
  publicationBranch(env.GITHUB_RUN_ID);
  const runId = env.GITHUB_RUN_ID;
  const repo = safeRepo(env.GITHUB_REPOSITORY);
  io.opts = { ...(io.opts ?? {}), cwd: io.opts?.cwd ?? process.cwd(), env };

  if (mode === 'commit-only') {
    const hasDiff = pendingDiff(io);
    const base = assertSha(gitText(io, ['rev-parse', 'HEAD']), 'HEAD');
    if (!hasDiff) {
      setOutput(env, 'has_diff', 'false');
      console.log('[publications] no feed diff; leaving main unpushed');
      return { action: 'no_change', hasDiff: false, sha: base, commands: [] };
    }
    const branch = publicationBranch(runId);
    if (dryRun) {
      const plan = planPublication({ runId, hasDiff: true, currentMainSha: base, openPrs: [] });
      console.log(`[publications] dry-run ${JSON.stringify(plan)}`);
      setOutput(env, 'has_diff', 'true');
      setOutput(env, 'branch', branch);
      return { action: 'dry-run', hasDiff: true, branch, commands: [] };
    }
    io.exec('git', ['config', 'user.name', 'publications-feed-bot'], io.opts);
    io.exec('git', ['config', 'user.email', 'publications@macbrainslabs.org'], io.opts);
    io.exec('git', ['checkout', '-B', branch], io.opts);
    io.exec('git', ['add', '--', ...FEED_PATHS], io.opts);
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    io.exec('git', ['commit', '-m', `publications: archive feed recheck ${stamp}`], io.opts);
    const sha = assertSha(gitText(io, ['rev-parse', 'HEAD']), 'candidate');
    const head = gitText(io, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head !== branch) throw fail(`commit landed on ${head}`);
    setOutput(env, 'has_diff', 'true');
    setOutput(env, 'sha', sha);
    setOutput(env, 'branch', branch);
    console.log(`[publications] candidate ${sha} on ${branch}; not pushed`);
    return { action: 'committed', hasDiff: true, sha, branch, commands: [] };
  }

  const head = gitText(io, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (mode === 'push' && (head === 'main' || head === 'master')) throw fail('refusing to publish from main');
  if (mode === 'no-diff' && head.startsWith('publications/recheck-')) throw fail('no-diff must run on the main checkout');
  const sha = assertSha(gitText(io, ['rev-parse', 'HEAD']), 'HEAD');
  const base = mode === 'push' ? assertSha(gitText(io, ['rev-parse', 'HEAD^']), 'base') : sha;
  if (mode === 'push') {
    const expected = publicationBranch(runId);
    if (head !== expected) throw fail(`HEAD is ${head}, not ${expected}`);
    if (env.CANDIDATE_SHA && env.CANDIDATE_SHA !== sha) throw fail('HEAD does not match the checked candidate');
  }
  const openPrs = dryRun ? [] : await withRetries(() => listFeedPrs(io), { wait: () => Promise.resolve() });
  const plan = planPublication({ runId, hasDiff: mode === 'push', currentMainSha: base, openPrs });
  const bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-body-'));
  const bodyFile = path.join(bodyDir, 'body.md');
  fs.writeFileSync(bodyFile, candidateBody({ sha: mode === 'push' ? sha : base, base, runId }));
  const commands = await executePlan(plan, {
    io,
    dryRun,
    repo,
    sha,
    runId,
    title: `publications: archive feed recheck ${publicationBranch(runId).slice('publications/recheck-'.length)}`,
    bodyFile,
    statusDescription: 'candidate checks passed before the pull request was opened'
  });
  console.log(`[publications] ${plan.action} commands=${commands.length} dry_run=${dryRun}`);
  return { ...plan, commands, sha, dryRun };
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  runPublicationCli(process.argv.slice(2)).catch(err => {
    console.error(`[publications] FATAL: ${err && err.message ? err.message : String(err)}`);
    process.exit(err && err.retryable === false ? 1 : 1);
  });
}
