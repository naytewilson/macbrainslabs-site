#!/usr/bin/env node
// Fixture tests for diagnostic research records: release tags ane-record-<24 hex>
// whose records index entry has kind "diagnostic". Network access is stubbed:
// globalThis.fetch serves only the fixture URLs and answers 404 for anything
// else, so a test also fails if the builder reaches for an address it should
// not. The fixture mirrors the archive repository's diagnostic layout: six
// release assets (bundle, attestation, execution log, deletion disclosure,
// preview, SHA256SUMS), a canonical attestation at the tag bound to the
// records index, and a Zenodo version bound to the tag's tree URL.
// Dependency-free; run: node scripts/test-publications-diagnostic-records.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAneRecord, coreKey, lastKnownGoodDecision, qualifiesPolicy,
  renderDiagRecord, renderFeedPage, renderIndexBlock, resetZenodoCache
} from './update-publications.mjs';

const REPO = 'macbrainslabs/ane-research-records';
const CONCEPT = '10.5281/zenodo.23798036';
const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveFeed = JSON.parse(fs.readFileSync(path.join(siteRoot, 'publications/publications.json'), 'utf8'));
const legacy = liveFeed.records.find(r => r.tag === 'v0.1.0');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function canon(x) {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PROFILE = '2f'.repeat(32);
const SCOPE = 'same-chip, byte-reproducible on Apple A18 Pro (Mac17,5), macOS 27.2 (build 26B123), CoreML 3600.25.2; ANE execution INFERRED from Core ML compute-plan placement; no novelty claim';

function fixture({ decision = 'INCLUDE', minted = true, tamper = null, prettyAttestation = false, dropRun = false, crossDeviceLie = false, tagHex = 'ab'.repeat(12), indexKind = 'diagnostic', binding = 'tree' } = {}) {
  const tag = `ane-record-${tagHex}`;
  const version = 'v0.2.0';
  const findingId = `finding:${'5'.repeat(40)}`;
  const siteUrl = `https://macbrainslabs.org/research/records/${tag}/`;
  const runs = [
    ['pf-a', 'pre-freeze', false, true], ['pf-b', 'pre-freeze', false, true], ['pf-c', 'pre-freeze', false, true],
    ['counted-1', 'pass', true, 'deleted'], ['counted-2', 'pass', true, true], ['counted-3', 'pass', true, true],
    ['counted-4', 'pass', true, true], ['counted-5', 'pass', true, true]
  ];
  const lines = [{ kind: 'log-header', profileHash: PROFILE, schemaVersion: 1 },
    ...runs.map(([runId, status, counted, present]) => ({ kind: 'execution', runId, status, counted, present, profileHash: PROFILE, toolCommit: 'c'.repeat(40), runStartedAt: '2026-11-02T20:00:00Z' }))];
  if (dropRun) lines.pop();
  const bundleObj = {
    schema: 'macbrains.research.diagnostic-review-bundle.v1', findingId, claimScope: SCOPE,
    claim: "Fixture claim: same chip only, not binary identity and not cross-device scientific replication; Neo's runs & no novelty claim.",
    evidence: { byteReproducibility: { profileHash: PROFILE, crossDeviceReplication: false }, priorArt: { noveltyClaim: 'UNCLAIMED' } }
  };
  const files = {
    'bundle.json': JSON.stringify(bundleObj, null, 2),
    'execution-log.jsonl': `${lines.map(l => JSON.stringify(l)).join('\n')}\n`,
    'deletion-disclosure.md': '# Fixture deletion disclosure\n',
    'preview.md': '# Fixture preview\n'
  };
  const counts = { logged: 8, counted: 5, preFreeze: 3, deleted: 1 };
  const att = {
    schema: 'macbrains.dataset.diagnostic-attestation.v1', tag, version, findingId, siteUrl, conceptDoi: CONCEPT, tier: 'diagnostic',
    title: "Neo's L14 diagnostic & same chip",
    claim: bundleObj.claim, claimScope: SCOPE, noveltyClaim: 'UNCLAIMED',
    bundle: { file: 'bundle.json', sha256: sha(files['bundle.json']), schema: bundleObj.schema, round: 5 },
    reviewedPackage: { sha256: 'c1'.repeat(32), schema: 'macbrains.research.handoff.v5.v1', note: 'Fixture.' },
    policy: { digest: '3c'.repeat(32), commit: '4d'.repeat(20) },
    finalReview: { reviewer: 'macbrains-labs-reviewer', decision, reviewedPackageSha256: 'c1'.repeat(32), verdictReceiptSha256: '4f'.repeat(32) },
    pipelineReviews: [
      { role: 'evidence_reviewer', model: 'opencode-go/deepseek-v4.1-flash', verdict: 'INCLUDE', score: 0.82, sessionId: 'ses_fixture_evidence' },
      { role: 'skeptical_reviewer', model: 'opencode-go/glm-5.3', verdict: 'INCLUDE', score: 0.8, sessionId: 'ses_fixture_skeptic' }
    ],
    replication: { scope: 'same-chip', crossDeviceReplication: crossDeviceLie, profileHash: PROFILE, ...counts },
    files: Object.entries(files).map(([name, content]) => ({ name, sha256: sha(content), bytes: Buffer.byteLength(content) }))
  };
  const attText = prettyAttestation ? `${JSON.stringify(att, null, 2)}\n` : `${canon(att)}\n`;
  const assetFiles = {
    'bundle.json': files['bundle.json'], 'attestation.json': attText, 'execution-log.jsonl': files['execution-log.jsonl'],
    'deletion-disclosure.md': files['deletion-disclosure.md'], 'preview.md': files['preview.md']
  };
  assetFiles.SHA256SUMS = Object.entries(assetFiles).map(([n, c]) => `${sha(c)}  ${n}`).join('\n') + '\n';
  const assets = Object.entries(assetFiles).map(([name, content], i) => ({
    id: 950 + i, name, size: Buffer.byteLength(content), digest: `sha256:${sha(content)}`,
    browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`
  }));
  const entry = {
    kind: indexKind, tag, version, title: "Neo's L14 diagnostic & same chip", findingId, path: `records/${tag}/`, releasedOn: '2026-11-03',
    bundleSha256: sha(files['bundle.json']), reviewedPackageSha256: 'c1'.repeat(32), attestationSha256: sha(attText),
    replication: { scope: 'same-chip', claim: SCOPE, profileHash: PROFILE, ...counts }, siteUrl
  };
  const index = {
    schema: 'macbrains.dataset.records-index.v1', series: 'MacBrains Labs ANE Research Records', conceptDoi: CONCEPT,
    baseline: { version: 'v0.1.0', tag: 'v0.1.0', versionDoi: '10.5281/zenodo.23798037' }, records: [entry]
  };
  const release = {
    id: 4343, tag_name: tag, name: `ANE research record ${version}`, html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    published_at: '2026-11-03T12:00:00Z', draft: false, prerelease: false, body: 'Prose that must never be rendered <script>.', assets
  };
  const versionDoi = '10.5281/zenodo.23900002';
  const hit = (id, doi, v, t, b = 'tree') => ({ id, doi, conceptdoi: CONCEPT, conceptrecid: '23798036',
    files: b === 'archive' ? [{ key: `${REPO}-${t}.zip` }] : b === 'archive-wrong' ? [{ key: `${REPO}-v9.9.9.zip` }] : b === 'archive-extra' ? [{ key: `${REPO}-${t}.zip` }, { key: 'extra.zip' }] : [],
    metadata: { version: v, license: { id: 'cc-by-4.0' }, creators: [{ name: 'Wilson, Nayte', orcid: '0009-0003-4026-8212' }],
      related_identifiers: b === 'tree' ? [{ identifier: `https://github.com/${REPO}/tree/${t}`, relation: 'isSupplementTo' }]
        : [{ identifier: `https://github.com/${REPO}`, relation: 'isSupplementTo' }] } });
  const hits = [hit(23798037, '10.5281/zenodo.23798037', 'v0.1.0', 'v0.1.0'), ...(minted ? [hit(23900002, versionDoi, version, tag, binding)] : [])];
  const routes = new Map();
  const contents = (p, text) => routes.set(`https://api.github.com/repos/${REPO}/contents/${p}?ref=${tag}`,
    JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') }));
  contents('records/index.json', `${JSON.stringify(index, null, 2)}\n`);
  contents(`records/${tag}/attestation.json`, attText);
  for (const a of assets) routes.set(a.browser_download_url, tamper === a.name ? assetFiles[a.name].replace('Fixture', 'Tampered') : assetFiles[a.name]);
  routes.set('https://zenodo.org/api/records?q=conceptrecid:23798036&allversions=true&sort=newest&size=25&page=1',
    JSON.stringify({ hits: { total: hits.length, hits } }));
  return { tag, version, release, routes, assetFiles, entry, versionDoi, siteUrl };
}

const fetched = [];
function stubFetch(routes) {
  fetched.length = 0;
  resetZenodoCache();
  globalThis.fetch = async url => {
    const u = String(url);
    fetched.push(u);
    return routes.has(u) ? new Response(routes.get(u), { status: 200 }) : new Response('not found', { status: 404 });
  };
}
async function build(opts) {
  const fx = fixture(opts);
  stubFetch(fx.routes);
  const rec = await buildAneRecord(fx.release);
  for (const u of fetched) assert.ok(fx.routes.has(u), `builder fetched an unexpected URL: ${u}`);
  return { fx, rec };
}
const guard = (rec, prefix) => rec.verification.guards.find(g => g.name.startsWith(prefix));

let ran = 0, failed = 0;
async function t(name, fn) {
  ran++;
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack || e.message}`); }
}

await t('verified diagnostic record: every guard passes; kind, bindings, recounted executions and DOI', async () => {
  const { fx, rec } = await build();
  assert.equal(rec.kind, 'ane-diagnostic');
  assert.equal(rec.verification.state, 'verified', JSON.stringify(rec.verification.guards));
  assert.equal(rec.verification.guards.length, 7);
  assert.ok(rec.verification.guards.every(g => g.state === 'pass'));
  assert.equal(rec.record_url, fx.siteUrl);
  assert.equal(rec.bundle_sha256, fx.entry.bundleSha256);
  assert.equal(rec.attestation_sha256, fx.entry.attestationSha256);
  assert.deepEqual(rec.replication, { scope: 'same-chip', claim: SCOPE, cross_device_replication: false, profile_hash: PROFILE, logged: 8, counted: 5, pre_freeze: 3, deleted: 1 });
  assert.equal(rec.review.decision, 'INCLUDE');
  assert.equal(rec.review.reviewed_package_sha256, 'c1'.repeat(32));
  assert.equal(rec.review.verdict_receipt_sha256, '4f'.repeat(32));
  assert.deepEqual(rec.review.pipeline.map(p => [p.role, p.verdict]), [['evidence_reviewer', 'INCLUDE'], ['skeptical_reviewer', 'INCLUDE']]);
  assert.equal(rec.doi.version_doi, fx.versionDoi);
  assert.equal(rec.doi.registered_state, 'registered_verified');
  assert.deepEqual(rec.assets.map(a => a.name), ['bundle.json', 'attestation.json', 'execution-log.jsonl', 'deletion-disclosure.md', 'preview.md', 'SHA256SUMS']);
  for (const a of rec.assets) assert.equal(a.sha256, sha(fx.assetFiles[a.name]));
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'publish');
});

await t('tampered bundle bytes -> degraded and held', async () => {
  const { rec } = await build({ tamper: 'bundle.json' });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'exactly six release assets').detail, /bundle\.json: downloaded bytes do not hash to the registered digest/);
  assert.equal(rec.assets.find(a => a.name === 'bundle.json').sha256, null);
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'hold');
});

await t('non-canonical attestation at the tag -> degraded', async () => {
  const { rec } = await build({ prettyAttestation: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'attestation at the tag').detail, /not canonical JSON/);
});

await t('HOLD final review -> degraded', async () => {
  const { rec } = await build({ decision: 'HOLD' });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'final review is INCLUDE').detail, /decision is HOLD, not INCLUDE/);
  assert.equal(rec.review.decision, 'HOLD');
});

await t('a dropped execution line is caught by recounting the released log', async () => {
  const { rec } = await build({ dropRun: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'scope, setup profile').detail, /executions recounted from the released log differ on: logged, counted/);
});

await t('an attested cross-device flag on a same-chip record -> degraded', async () => {
  const { rec } = await build({ crossDeviceLie: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'scope, setup profile').detail, /cross-device flag disagrees/);
  assert.equal(rec.replication.cross_device_replication, false);
});

await t('Zenodo version bound only by its integration archive name (no tree link) -> verified', async () => {
  const { rec } = await build({ binding: 'archive' });
  assert.equal(rec.verification.state, 'verified');
  assert.equal(rec.doi.registered_state, 'registered_verified');
});

await t('wrong archive name, extra files or no binding at all -> not minted, held', async () => {
  for (const binding of ['archive-wrong', 'archive-extra', 'none']) {
    const { rec } = await build({ binding });
    assert.equal(rec.verification.state, 'degraded', binding);
    assert.equal(rec.doi.registered_state, 'not_minted', binding);
  }
});

await t('Zenodo version not minted yet -> degraded, held, and no version DOI rendered', async () => {
  const { rec } = await build({ minted: false });
  assert.equal(rec.verification.state, 'degraded');
  assert.equal(rec.doi.registered_state, 'not_minted');
  const out = lastKnownGoodDecision(liveFeed.records, [rec, ...liveFeed.records]);
  assert.equal(out.decision, 'hold');
  assert.ok(!renderDiagRecord(rec).includes('Version DOI'));
});

await t('an unknown records index kind is a structural refusal', async () => {
  const fx = fixture({ indexKind: 'mystery' });
  stubFetch(fx.routes);
  await assert.rejects(buildAneRecord(fx.release), /records index entry kind is unsupported/);
});

await t('diagnostic record renders scope label, recorded scope, run accounting, hashes, assets, DOI and record link', async () => {
  const { fx, rec } = await build();
  const html = renderFeedPage({ generated_at: '2026-11-03T12:30:00Z', upstream_status: 'ok', records: [rec, legacy] });
  const at = html.indexOf(`data-tag="${fx.tag}"`);
  const art = html.slice(at, html.indexOf('</article>', at));
  assert.ok(art.includes('data-kind="ane-diagnostic"'));
  assert.ok(art.includes('Same-chip rerun: repeatability only, not cross-device replication'));
  assert.ok(art.includes(`<q>${esc(SCOPE)}</q>`));
  assert.ok(art.includes(esc("Neo's L14 diagnostic & same chip")) && !art.includes("Neo's L14"), 'title not escaped');
  assert.ok(art.includes('8 executions logged and disclosed: 5 after the setup profile froze, 3 before it; 1 frozen run output deleted, recovered record disclosed'));
  for (const h of [PROFILE, 'c1'.repeat(32), '4f'.repeat(32), fx.entry.bundleSha256, fx.entry.attestationSha256]) assert.ok(art.includes(`<code>${h}</code>`), `${h.slice(0, 8)} not shown`);
  for (const a of rec.assets) assert.ok(art.includes(`<code>${a.sha256}</code>`), `asset ${a.name} digest not shown`);
  assert.ok(art.includes(`href="https://doi.org/${fx.versionDoi}"`));
  assert.ok(art.includes(`href="${fx.siteUrl}"`));
  assert.ok(!html.includes('Prose that must never be rendered'));
  assert.ok(html.includes('Seven checks stand between upstream and this page.'));
  assert.ok(html.includes('<h3>Diagnostic research records</h3>'));
  const block = renderIndexBlock({ records: [rec, legacy] });
  assert.ok(block.includes(`<a href="${fx.siteUrl}"><span class="id">v0.2.0</span>`));
  assert.ok(block.includes('not cross-device replication'));
});

await t('feed of vX.Y.Z records alone stays byte-identical; the diagnostic policy text fits the contract', async () => {
  assert.equal(qualifiesPolicy(liveFeed.records), liveFeed.policy.qualifies);
  assert.equal(renderFeedPage({ ...liveFeed, records: liveFeed.records }), fs.readFileSync(path.join(siteRoot, 'publications/index.html'), 'utf8'));
  const { rec } = await build();
  const p = qualifiesPolicy([rec, legacy]);
  assert.ok(p.length <= 600 && !/[<>"]/.test(p) && p.includes('attestation'), 'diagnostic policy text out of contract');
});

await t('diagnostic core ignores re-derived verification state', async () => {
  const ok = (await build()).rec;
  const flaky = structuredClone(ok);
  flaky.verification = { state: 'degraded', guards: [{ name: 'x', state: 'degraded', detail: null }] };
  flaky.doi.crosscheck = { state: 'unreachable', comparisons: null, detail: null };
  flaky.doi.registered_state = 'unverifiable_now';
  flaky.assets = flaky.assets.map(a => ({ ...a, sha256: null }));
  assert.equal(coreKey(flaky), coreKey(ok));
  assert.equal(lastKnownGoodDecision([ok, legacy], [ok, legacy]).decision, 'no_change');
  assert.equal(lastKnownGoodDecision([ok, legacy], [flaky, legacy]).decision, 'hold');
});

// The site's real diagnostic record page (package record pages are skipped),
// moved in a scratch copy to the fixture's tag and given the fixture's bound
// values, so check-site's page binding is exercised without touching the real page.
const pageDir = path.join(siteRoot, 'research/records');
const realTag = (fs.existsSync(pageDir) ? fs.readdirSync(pageDir).sort() : []).find(n => /^ane-record-[0-9a-f]{24}$/.test(n)
  && !fs.readFileSync(path.join(pageDir, n, 'index.html'), 'utf8').includes('data-record-kind="package"'));

function siteCopyWith(data, { pageFor = null, doiOnPage = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pubfeed-diag-'));
  fs.cpSync(siteRoot, tmp, { recursive: true, filter: src => path.basename(src) !== '.git' });
  data.policy = { ...liveFeed.policy, qualifies: qualifiesPolicy(data.records) };
  data.upstream_status = data.records.every(r => r.verification.state === 'verified') ? 'ok' : 'partial';
  fs.writeFileSync(path.join(tmp, 'publications/publications.json'), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(tmp, 'publications/index.html'), renderFeedPage(data));
  const home = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  const s = '<!-- publications-latest:start -->', e = '<!-- publications-latest:end -->';
  fs.writeFileSync(path.join(tmp, 'index.html'), `${home.slice(0, home.indexOf(s) + s.length)}\n${renderIndexBlock(data)}\n${home.slice(home.indexOf(e))}`);
  if (pageFor) {
    const from = path.join(tmp, 'research/records', realTag), to = path.join(tmp, 'research/records', pageFor.tag);
    fs.renameSync(from, to);
    // A renamed synthetic public record has a renamed public share card too;
    // keep the production site's exact per-route asset contract enabled.
    for (const ext of ['png', 'svg']) {
      const oldArt = path.join(tmp, 'assets/social', 'research-records-' + realTag + '.' + ext);
      const newArt = path.join(tmp, 'assets/social', 'research-records-' + pageFor.tag + '.' + ext);
      fs.copyFileSync(oldArt, newArt);
    }
    for (const f of [path.join(to, 'index.html'), path.join(tmp, 'sitemap.xml'), path.join(tmp, 'research/index.html')]) {
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(realTag).join(pageFor.tag));
    }
    const r = pageFor.replication;
    const bound = `<p>${esc(pageFor.title)} · <q>${esc(r.claim)}</q> · ${r.profile_hash} · ${pageFor.bundle_sha256} · ${pageFor.attestation_sha256} · ${pageFor.review.reviewed_package_sha256} · ${r.logged} logged executions</p>`
      + (doiOnPage && pageFor.doi.version_doi ? `<p><a href="https://doi.org/${pageFor.doi.version_doi}">DOI ${pageFor.doi.version_doi}</a></p>` : '');
    const p = path.join(to, 'index.html');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('</article>', `${bound}\n</article>`));
  }
  const run = spawnSync(process.execPath, [path.join(tmp, 'scripts/check-site.mjs')], { cwd: tmp, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  return run;
}

await t('check-site accepts a verified diagnostic record bound to its page, and rejects mislabelled or unbound ones', async () => {
  assert.ok(realTag, 'the site has no research record page to exercise');
  const { rec } = await build();
  const data = recs => ({ ...liveFeed, generated_at: '2026-11-03T12:30:00Z', records: recs });
  const ok = siteCopyWith(data([rec, legacy]), { pageFor: rec });
  assert.equal(ok.status, 0, `check-site failed:\n${ok.stderr}`);
  for (const name of ['publications feed diagnostic research records are bound, labelled and verified',
    'publications page shows each diagnostic research record with its bindings, run accounting and scope label',
    'research record pages state their scope and bind to the feed']) assert.ok(ok.stdout.includes(`PASS ${name}`), name);
  const lie = siteCopyWith(data([{ ...rec, replication: { ...rec.replication, cross_device_replication: true } }, legacy]), { pageFor: rec });
  assert.notEqual(lie.status, 0, 'check-site accepted a same-chip record labelled as cross-device replication');
  assert.match(lie.stderr, /a same-chip rerun must never count as cross-device replication/);
  const noDoi = siteCopyWith(data([rec, legacy]), { pageFor: rec, doiOnPage: false });
  assert.notEqual(noDoi.status, 0, 'check-site accepted a verified record whose page lacks the version DOI');
  assert.match(noDoi.stderr, /verified version DOI not shown on the record page/);
  const noPage = siteCopyWith(data([rec, legacy]));
  assert.notEqual(noPage.status, 0, 'check-site accepted a diagnostic record without its page');
  assert.match(noPage.stderr, /record page missing/);
});

console.log(`diagnostic record feed tests: ${ran - failed}/${ran} passed`);
if (failed) process.exitCode = 1;
