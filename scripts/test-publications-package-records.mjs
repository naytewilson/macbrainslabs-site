#!/usr/bin/env node
// Fixture tests for package research records: release tags ane-record-<24 hex>
// whose records index entry has kind "package". Network access is stubbed:
// globalThis.fetch serves only the fixture URLs and answers 404 for anything
// else, so a test also fails if the builder reaches for an address it should
// not. The fixture mirrors the archive repository's package layout: five
// release assets (attestation, preview, reviewed record, package archive,
// SHA256SUMS), a canonical attestation at the tag bound to the records index,
// the package file list, the reviewed record and one device-wide execution
// log per clean-room arm at the tag, and a Zenodo version bound to the tag.
// Dependency-free; run: node scripts/test-publications-package-records.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAneRecord, coreKey, lastKnownGoodDecision, qualifiesPolicy,
  renderFeedPage, renderIndexBlock, renderPkgRecord, resetZenodoCache
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

const SCOPE = "same-chip, single device (Mac17,5); MIL text byte equality only, one fixture & two arms; no Core ML compile, ANE execution or numerics; no novelty claim";
const ARMS = [
  { arm: 'fugu', profileHash: '09'.repeat(32), profileCommit: '01'.repeat(20), toolCommit: 'd4'.repeat(20), logsPassed: false },
  { arm: 'ane-re', profileHash: '84'.repeat(32), profileCommit: '87'.repeat(20), toolCommit: '0a'.repeat(20), logsPassed: true }
];

function fixture({ decision = 'INCLUDE', minted = true, tamper = null, prettyAttestation = false, dropRun = false, failRun = false, tamperLogAtTag = false, tamperListAtTag = false, indexKind = 'package', tagHex = 'b8'.repeat(12) } = {}) {
  const tag = `ane-record-${tagHex}`;
  const version = 'v0.3.0';
  const siteUrl = `https://macbrainslabs.org/research/records/${tag}/`;
  const title = "Fixture MIL parity & Neo's same chip";
  const logs = new Map();
  const arms = ARMS.map((a, ai) => {
    const lines = [];
    for (let i = 1; i <= 5; i++) {
      lines.push({ counted: true, kind: 'run_started', profileCommit: a.profileCommit, profileHash: a.profileHash, runStartedAt: `2026-11-07T0${i}:00:00Z`, toolCommit: a.toolCommit });
      const done = { byteIdentical: true, counted: true, exitCode: failRun && ai === 0 && i === 3 ? 1 : 0, kind: 'run_completed', profileHash: a.profileHash, runIndex: i };
      if (a.logsPassed) done.passed = true;
      lines.push(done);
    }
    if (dropRun && ai === 1) lines.splice(-2, 2);
    const text = `${lines.map(l => JSON.stringify(l)).join('\n')}\n`;
    const p = `package/execution-log/${a.profileHash}.jsonl`;
    logs.set(p, text);
    return { arm: a.arm, profileHash: a.profileHash, profileCommit: a.profileCommit, toolCommit: a.toolCommit, executionLog: p, executionLogSha256: sha(text), started: 5, completed: 5, passed: 5, tool: `cleanroom-${a.arm}` };
  });
  const recordText = '# Fixture reviewed record\n\nNOT PUBLISHED header kept as reviewed.\n';
  const tarText = 'fixture tar bytes\n';
  const filesList = `${sha(recordText)}  ./ANERECore_fixture_record.md\n${[...logs].map(([p, t]) => `${sha(t)}  ./${p.slice('package/'.length)}`).join('\n')}\n`;
  const preview = `# ${title}\n\nScope as recorded: ${SCOPE}.\n`;
  const releaseAssets = [
    { name: 'preview.md', sha256: sha(preview), bytes: Buffer.byteLength(preview) },
    { name: 'ANERECore_fixture_record.md', sha256: sha(recordText), bytes: Buffer.byteLength(recordText) },
    { name: 'package-fixture.tar', sha256: sha(tarText), bytes: Buffer.byteLength(tarText) }
  ];
  const att = {
    schema: 'macbrains.dataset.package-attestation.v1', tag, version, tier: 'diagnostic', title, siteUrl, conceptDoi: CONCEPT,
    reviewedPackage: { sha256: 'b8'.repeat(32), schema: 'macbrains.manager-handoff.v1', generatedAt: '2026-11-07T11:03:04.386Z', note: 'Fixture.' },
    package: { dir: 'package/', recordFile: 'ANERECore_fixture_record.md', recordSha256: sha(recordText), filesListSha256: sha(filesList), filesListed: 3, fileCount: 4,
      tar: { name: 'package-fixture.tar', sha256: sha(tarText), bytes: Buffer.byteLength(tarText) } },
    claimScope: SCOPE, noveltyClaim: 'UNCLAIMED', operations: ['tap', 'steer', 'functionWide'],
    replication: { scope: 'same-chip', crossDeviceReplication: false, arms, runsTotal: 10, runsPass: 10, runsFail: 0, crossArmComparison: 'fixture' },
    finalReview: { reviewer: 'macbrains-labs-reviewer', decision, round: 2, reviewedPackageSha256: 'b8'.repeat(32), verdictReceiptSha256: 'f8'.repeat(32) },
    notes: [{ id: 'N1', text: 'Fixture note.' }], disclosures: ['Fixture disclosure.'],
    releaseAssets
  };
  const attText = prettyAttestation ? `${JSON.stringify(att, null, 2)}\n` : `${canon(att)}\n`;
  const assetFiles = { 'attestation.json': attText, 'preview.md': preview, 'ANERECore_fixture_record.md': recordText, 'package-fixture.tar': tarText };
  assetFiles.SHA256SUMS = Object.entries(assetFiles).map(([n, c]) => `${sha(c)}  ${n}`).join('\n') + '\n';
  const assets = Object.entries(assetFiles).reverse().map(([name, content], i) => ({
    id: 970 + i, name, size: Buffer.byteLength(content), digest: `sha256:${sha(content)}`,
    browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`
  }));
  const entry = {
    kind: indexKind, tag, version, title, path: `records/${tag}/`, releasedOn: '2026-11-07',
    reviewedPackageSha256: 'b8'.repeat(32), recordSha256: sha(recordText), filesListSha256: sha(filesList), attestationSha256: sha(attText),
    replication: { scope: 'same-chip', claim: SCOPE, profileHashes: ARMS.map(a => a.profileHash), counted: 10, passed: 10, failed: 0 }, siteUrl
  };
  const index = {
    schema: 'macbrains.dataset.records-index.v1', series: 'MacBrains Labs ANE Research Records', conceptDoi: CONCEPT,
    baseline: { version: 'v0.1.0', tag: 'v0.1.0', versionDoi: '10.5281/zenodo.23798037' }, records: [entry]
  };
  const release = {
    id: 4545, tag_name: tag, name: `ANE research record ${version}`, html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    published_at: '2026-11-07T12:00:00Z', draft: false, prerelease: false, body: 'Prose that must never be rendered <script>.', assets
  };
  const versionDoi = '10.5281/zenodo.23990003';
  const hit = (id, doi, v, t) => ({ id, doi, conceptdoi: CONCEPT, conceptrecid: '23798036', files: [],
    metadata: { version: v, license: { id: 'cc-by-4.0' }, creators: [{ name: 'Wilson, Nayte', orcid: '0009-0003-4026-8212' }],
      related_identifiers: [{ identifier: `https://github.com/${REPO}/tree/${t}`, relation: 'isSupplementTo' }] } });
  const hits = [hit(23798037, '10.5281/zenodo.23798037', 'v0.1.0', 'v0.1.0'), ...(minted ? [hit(23990003, versionDoi, version, tag)] : [])];
  const routes = new Map();
  const contents = (p, text) => routes.set(`https://api.github.com/repos/${REPO}/contents/${p}?ref=${tag}`,
    JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') }));
  contents('records/index.json', `${JSON.stringify(index, null, 2)}\n`);
  contents(`records/${tag}/attestation.json`, attText);
  contents(`records/${tag}/package/FILES.sha256`, tamperListAtTag ? filesList.replace('./', './x') : filesList);
  contents(`records/${tag}/package/ANERECore_fixture_record.md`, recordText);
  for (const [p, text] of logs) contents(`records/${tag}/${p}`, tamperLogAtTag ? text.replace('"runIndex":1', '"runIndex":9') : text);
  for (const a of assets) routes.set(a.browser_download_url, tamper === a.name ? `${assetFiles[a.name]}tampered` : assetFiles[a.name]);
  routes.set('https://zenodo.org/api/records?q=conceptrecid:23798036&allversions=true&sort=newest&size=25&page=1',
    JSON.stringify({ hits: { total: hits.length, hits } }));
  return { tag, version, title, release, routes, assetFiles, entry, versionDoi, siteUrl };
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

await t('verified package record: every guard passes; bindings, per-arm recount and DOI', async () => {
  const { fx, rec } = await build();
  assert.equal(rec.kind, 'ane-package');
  assert.equal(rec.verification.state, 'verified', JSON.stringify(rec.verification.guards));
  assert.equal(rec.verification.guards.length, 7);
  assert.equal(rec.record_url, fx.siteUrl);
  assert.equal(rec.attestation_sha256, fx.entry.attestationSha256);
  assert.equal(rec.record_sha256, fx.entry.recordSha256);
  assert.equal(rec.files_list_sha256, fx.entry.filesListSha256);
  assert.deepEqual(rec.replication.profile_hashes, ARMS.map(a => a.profileHash));
  assert.equal(rec.replication.cross_device_replication, false);
  assert.deepEqual(rec.replication.arms.map(a => [a.arm, a.counted, a.passed]), [['fugu', 5, 5], ['ane-re', 5, 5]]);
  assert.equal(rec.review.decision, 'INCLUDE');
  assert.equal(rec.review.verdict_receipt_sha256, 'f8'.repeat(32));
  assert.equal(rec.doi.version_doi, fx.versionDoi);
  assert.equal(rec.doi.registered_state, 'registered_verified');
  assert.deepEqual(rec.assets.map(a => a.name), ['attestation.json', 'preview.md', 'ANERECore_fixture_record.md', 'package-fixture.tar', 'SHA256SUMS']);
  for (const a of rec.assets) assert.equal(a.sha256, sha(fx.assetFiles[a.name]));
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'publish');
  assert.equal(coreKey(rec), coreKey(JSON.parse(JSON.stringify(rec))));
});

await t('tampered package archive bytes -> degraded and held', async () => {
  const { rec } = await build({ tamper: 'package-fixture.tar' });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'exactly five release assets').detail, /package-fixture\.tar: downloaded bytes do not hash/);
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
});

await t('a dropped run in one arm is caught by recounting its log', async () => {
  const { rec } = await build({ dropRun: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'scope and every counted run').detail, /arm ane-re: runs recounted from the log differ on: started, completed, passed/);
});

await t('a failed run in an arm that logs no passed field is not counted as a pass', async () => {
  const { rec } = await build({ failRun: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'scope and every counted run').detail, /arm fugu: runs recounted from the log differ on: passed/);
  assert.deepEqual(rec.replication.arms.map(a => [a.arm, a.passed]), [['fugu', 4], ['ane-re', 5]]);
});

await t('an execution log at the tag that differs from its attested hash -> degraded', async () => {
  const { rec } = await build({ tamperLogAtTag: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'scope and every counted run').detail, /execution log at the tag differs from its attested hash/);
});

await t('a package file list at the tag that differs from the index -> degraded', async () => {
  const { rec } = await build({ tamperListAtTag: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'attestation at the tag').detail, /FILES\.sha256 at the tag differs/);
});

await t('Zenodo version not minted yet -> degraded, no DOI shown, update held', async () => {
  const { rec } = await build({ minted: false });
  assert.equal(rec.verification.state, 'degraded');
  assert.equal(rec.doi.registered_state, 'not_minted');
  assert.ok(!renderPkgRecord(rec).includes('Version DOI'));
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'hold');
});

await t('an unknown records index kind is a structural refusal', async () => {
  await assert.rejects(build({ indexKind: 'mystery' }), /records index entry kind is unsupported/);
});

await t('feed page and home block show the package record with its bindings and scope label', async () => {
  const { fx, rec } = await build();
  const data = { schema: 'macbrainslabs.publications.v1', generated_at: '2026-11-07T12:30:00Z', upstream_status: 'ok',
    policy: { qualifies: qualifiesPolicy([rec, legacy]) }, records: [rec, legacy] };
  assert.equal(qualifiesPolicy([rec, legacy]), qualifiesPolicy([{ kind: 'ane-diagnostic' }]));
  const html = renderFeedPage(data);
  assert.ok(html.includes('Seven checks stand between upstream and this page.'));
  assert.ok(html.includes('<span class="n">07</span><div><h3>Package research records</h3>'));
  const art = html.slice(html.indexOf(`data-tag="${fx.tag}"`), html.indexOf('</article>', html.indexOf(`data-tag="${fx.tag}"`)));
  for (const s of [esc(fx.title), esc(SCOPE), ...ARMS.map(a => a.profileHash), 'b8'.repeat(32), rec.record_sha256, rec.files_list_sha256, rec.attestation_sha256,
    '10 counted runs kept across 2 clean-room arms: 10 pass, 0 fail', 'not cross-device replication', `href="https://doi.org/${fx.versionDoi}"`]) assert.ok(art.includes(s), `missing ${s.slice(0, 40)}`);
  for (const a of rec.assets) assert.ok(art.includes(a.sha256));
  assert.ok(!html.includes('<script>.'), 'release prose rendered');
  const block = renderIndexBlock(data);
  assert.ok(block.includes(`href="${fx.siteUrl}"`) && block.includes('not cross-device replication') && block.includes('Package record · DOI registered'));
});

console.log(`package record feed tests: ${ran - failed}/${ran} passed`);
if (failed) process.exit(1);
