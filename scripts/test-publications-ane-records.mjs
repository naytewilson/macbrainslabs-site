#!/usr/bin/env node
// Fixture tests for reviewed research records (release tags ane-record-<24 hex>).
// Network access is stubbed: globalThis.fetch serves only the fixture URLs and
// answers 404 for anything else, so a test also fails if the builder reaches
// for an address it should not. The checks mirror the publication pipeline's
// own artifacts: four assets with registered digests, a canonical review
// package and a final verdict at the tag, and a Zenodo version bound to the
// tag's tree URL under the all-versions DOI.
// Dependency-free; run: node scripts/test-publications-ane-records.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildAneRecord, coreKey, lastKnownGoodDecision, qualifiesPolicy,
  renderAneRecord, renderFeedPage, renderIndexBlock, resetZenodoCache
} from './update-publications.mjs';

const REPO = 'macbrainslabs/ane-research-records';
const CONCEPT = '10.5281/zenodo.23798036';
const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveFeed = JSON.parse(fs.readFileSync(path.join(siteRoot, 'publications/publications.json'), 'utf8'));
const legacy = liveFeed.records.find(r => r.tag === 'v0.1.0');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// Independent canonical JSON (keys sorted recursively, no whitespace).
function canon(x) {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fixture({ decision = 'INCLUDE', minted = true, tamper = null, prettyPackage = false, scope = 'same-chip' } = {}) {
  const publicationId = 'pub.fixture.lfm-decode-0001';
  const tag = `ane-record-${sha(publicationId).slice(0, 24)}`;
  const version = 'v0.2.0';
  const files = {
    'finding.json': `${JSON.stringify({ title: "Neo's decode regime & ANE placement", summary: 'Fixture summary.' })}\n`,
    'citations.json': '[]\n',
    'preview.md': '# Fixture preview\n',
    'manifest.json': `${canon({ findingId: 'finding.fixture', findingRevision: 1 })}\n`
  };
  const assets = Object.entries(files).map(([name, content], i) => ({
    id: 900 + i, name, size: Buffer.byteLength(content), digest: `sha256:${sha(content)}`,
    browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`
  }));
  const claim = scope === 'same-chip'
    ? 'same-chip rerun on Apple M4 (repeatability), not cross-device replication'
    : 'cross-device replication across 2 devices';
  const replication = { scope, claim, profileHash: 'a1'.repeat(32), runCount: 5, passCount: 4, failCount: 1 };
  const siteUrl = `https://macbrainslabs.org/research/records/${tag}/`;
  const packageHash = 'b2'.repeat(32);
  const reviewPackage = {
    schema: 'macbrains.research.final-review-package.v1',
    assembledAt: '2026-11-02T09:00:00Z',
    publication: {
      publicationId, packageHash, manifestHash: 'c3'.repeat(32), releaseTag: tag,
      files: Object.entries(files).map(([name, content]) => ({ name, sha256: sha(content), bytes: Buffer.byteLength(content) }))
    },
    replication: { ...replication, crossDeviceReplication: scope === 'cross-device', runs: [] },
    targets: { conceptDoi: CONCEPT, datasetRepository: REPO, siteRepository: 'naytewilson/macbrainslabs-site', siteUrl }
  };
  const rpCanonical = canon(reviewPackage);
  const reviewPackageHash = sha(rpCanonical);
  const verdictBody = {
    schema: 'macbrains.research.final-review-verdict.v1', reviewer: 'macbrains-labs-reviewer', decision,
    reviewPackageHash, sourceMessageId: 'cmsg_fixture0000000001', reasons: [], decidedAt: '2026-11-02T10:00:00Z'
  };
  const verdictDigest = sha(canon(verdictBody));
  const index = {
    schema: 'macbrains.dataset.records-index.v1', series: 'MacBrains Labs ANE Research Records', conceptDoi: CONCEPT,
    baseline: { version: 'v0.1.0', tag: 'v0.1.0', versionDoi: '10.5281/zenodo.23798037' },
    records: [{
      tag, version, title: "Neo's decode regime & ANE placement", publicationId, packageHash, reviewPackageHash,
      verdictDigest, path: `records/${tag}/`, releasedOn: '2026-11-02', replication, siteUrl
    }]
  };
  const release = {
    id: 4242, tag_name: tag, name: `ANE research ${tag}`, html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    published_at: '2026-11-02T12:00:00Z', draft: false, prerelease: false,
    body: 'Prose that must never be rendered <script>.\n\nMACBRAINS_RESEARCH_RECEIPT_V1\n{}', assets
  };
  const versionDoi = '10.5281/zenodo.23900001';
  const baselineHit = {
    id: 23798037, doi: '10.5281/zenodo.23798037', conceptdoi: CONCEPT, conceptrecid: '23798036',
    metadata: { version: 'v0.1.0', license: { id: 'cc-by-4.0' }, creators: [{ name: 'Wilson, Nayte', orcid: '0009-0003-4026-8212' }],
      related_identifiers: [{ identifier: `https://github.com/${REPO}/tree/v0.1.0`, relation: 'isSupplementTo' }] }
  };
  const mintedHit = {
    id: 23900001, doi: versionDoi, conceptdoi: CONCEPT, conceptrecid: '23798036',
    metadata: { version, license: { id: 'cc-by-4.0' }, creators: [{ name: 'Wilson, Nayte', orcid: '0009-0003-4026-8212' }],
      related_identifiers: [{ identifier: `https://github.com/${REPO}/tree/${tag}`, relation: 'isSupplementTo' }] }
  };
  const hits = minted ? [mintedHit, baselineHit] : [baselineHit];
  const routes = new Map();
  const contents = (p, text) => routes.set(`https://api.github.com/repos/${REPO}/contents/${p}?ref=${tag}`,
    JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') }));
  contents('records/index.json', `${JSON.stringify(index, null, 2)}\n`);
  contents(`records/${tag}/review-package.json`, prettyPackage ? `${JSON.stringify(reviewPackage, null, 2)}\n` : `${rpCanonical}\n`);
  contents(`records/${tag}/final-verdict.json`, `${canon({ ...verdictBody, verdictDigest })}\n`);
  for (const a of assets) routes.set(a.browser_download_url, tamper === a.name ? files[a.name].replace('Fixture', 'Tampered') : files[a.name]);
  routes.set('https://zenodo.org/api/records?q=conceptrecid:23798036&allversions=true&sort=newest&size=25&page=1',
    JSON.stringify({ hits: { total: hits.length, hits } }));
  return { tag, version, release, routes, files, replication, reviewPackageHash, verdictDigest, versionDoi, siteUrl };
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

await t('verified ane-record: every guard passes and the record carries its kind, bindings and DOI', async () => {
  const { fx, rec } = await build();
  assert.equal(rec.kind, 'ane-record');
  assert.equal(rec.verification.state, 'verified', JSON.stringify(rec.verification.guards));
  assert.ok(rec.verification.guards.length >= 6 && rec.verification.guards.every(g => g.state === 'pass'));
  assert.equal(rec.tag, fx.tag);
  assert.equal(rec.version, fx.version);
  assert.equal(rec.record_url, fx.siteUrl);
  assert.equal(rec.replication.claim, fx.replication.claim);
  assert.equal(rec.replication.cross_device_replication, false);
  assert.deepEqual([rec.replication.run_count, rec.replication.pass_count, rec.replication.fail_count], [5, 4, 1]);
  assert.equal(rec.review.review_package_hash, fx.reviewPackageHash);
  assert.equal(rec.review.verdict_digest, fx.verdictDigest);
  assert.equal(rec.review.decision, 'INCLUDE');
  assert.equal(rec.doi.version_doi, fx.versionDoi);
  assert.equal(rec.doi.zenodo_record_url, 'https://zenodo.org/records/23900001');
  assert.equal(rec.doi.registered_state, 'registered_verified');
  assert.deepEqual(rec.assets.map(a => a.name), ['finding.json', 'citations.json', 'preview.md', 'manifest.json']);
  for (const a of rec.assets) assert.equal(a.sha256, sha(fx.files[a.name]));
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'publish');
});

await t('tampered asset (bytes differ from the registered digest) -> degraded', async () => {
  const { rec } = await build({ tamper: 'finding.json' });
  assert.equal(rec.verification.state, 'degraded');
  const g = guard(rec, 'exactly four release assets');
  assert.equal(g.state, 'degraded');
  assert.match(g.detail, /finding\.json: downloaded bytes do not hash to the registered digest/);
  assert.equal(rec.assets.find(a => a.name === 'finding.json').sha256, null);
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'hold');
});

await t('HOLD verdict for the review package hash -> degraded', async () => {
  const { rec } = await build({ decision: 'HOLD' });
  assert.equal(rec.verification.state, 'degraded');
  const g = guard(rec, 'final verdict at the tag');
  assert.equal(g.state, 'degraded');
  assert.match(g.detail, /decision is HOLD, not INCLUDE/);
  assert.equal(rec.review.decision, 'HOLD');
  assert.equal(lastKnownGoodDecision([legacy], [rec, legacy]).decision, 'hold');
});

await t('Zenodo version not minted yet -> degraded and held under last-known-good', async () => {
  const { rec } = await build({ minted: false });
  assert.equal(rec.verification.state, 'degraded');
  assert.equal(rec.doi.version_doi, null);
  assert.equal(rec.doi.registered_state, 'not_minted');
  assert.equal(guard(rec, 'Zenodo version').state, 'degraded');
  const out = lastKnownGoodDecision(liveFeed.records, [rec, ...liveFeed.records]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(rec.tag) && r.includes('holding the update')), out.reasons.join('; '));
  assert.ok(!renderAneRecord(rec).includes('Version DOI'), 'an unminted record must not show a version DOI');
});

await t('ane-record renders the same-chip label, verbatim claim, hashes, assets, DOI and record link', async () => {
  const { fx, rec } = await build();
  const html = renderFeedPage({ generated_at: '2026-11-02T12:30:00Z', upstream_status: 'ok', records: [rec, legacy] });
  const art = html.slice(html.indexOf(`data-tag="${fx.tag}"`), html.indexOf('</article>', html.indexOf(`data-tag="${fx.tag}"`)));
  assert.ok(art.includes('Same-chip rerun: repeatability only, not cross-device replication'));
  assert.ok(art.includes(`<q>${esc(fx.replication.claim)}</q>`), 'claim not rendered verbatim');
  assert.ok(art.includes(esc("Neo's decode regime & ANE placement")) && !art.includes("Neo's decode"), 'title not escaped');
  assert.ok(art.includes(`Setup profile <code>${fx.replication.profileHash}</code>`));
  assert.ok(art.includes('5 runs kept: 4 pass, 1 fail'));
  assert.ok(art.includes(`Review package <code>${fx.reviewPackageHash}</code>`));
  assert.ok(art.includes(`INCLUDE verdict from <code>macbrains-labs-reviewer</code>, digest <code>${fx.verdictDigest}</code>`));
  for (const a of rec.assets) assert.ok(art.includes(`<code>${a.sha256}</code>`), `asset ${a.name} digest not shown`);
  assert.ok(art.includes(`href="https://doi.org/${fx.versionDoi}"`));
  assert.ok(art.includes(`href="${fx.siteUrl}"`));
  assert.ok(!html.includes('Prose that must never be rendered'), 'release prose leaked into the page');
  assert.ok(html.includes('Seven checks stand between upstream and this page.'));
  const block = renderIndexBlock({ records: [rec, legacy] });
  assert.ok(block.includes(`<a href="${fx.siteUrl}"><span class="id">v0.2.0</span>`));
  assert.ok(block.includes('not cross-device replication'));
});

await t('cross-device record reads as cross-device replication, never with the same-chip label', async () => {
  const { rec } = await build({ scope: 'cross-device' });
  assert.equal(rec.verification.state, 'verified');
  assert.equal(rec.replication.cross_device_replication, true);
  assert.ok(!renderAneRecord(rec).includes('not cross-device replication'));
});

await t('non-canonical review package (pretty-printed bytes) -> degraded', async () => {
  const { rec } = await build({ prettyPackage: true });
  assert.equal(rec.verification.state, 'degraded');
  assert.match(guard(rec, 'review package at the tag').detail, /not canonical JSON/);
});

await t('feed of vX.Y.Z records alone keeps its policy text and qualify section bytes', async () => {
  assert.equal(qualifiesPolicy(liveFeed.records), liveFeed.policy.qualifies);
  const html = renderFeedPage({ ...liveFeed, records: liveFeed.records });
  assert.equal(html, fs.readFileSync(path.join(siteRoot, 'publications/index.html'), 'utf8'), 'legacy-only page must stay byte-identical');
  const { rec } = await build();
  const both = qualifiesPolicy([rec, legacy]);
  assert.ok(both.length <= 600 && !/[<>"]/.test(both) && both.includes('ane-record-'), 'policy text for both kinds is out of contract');
});

await t('ane-record core ignores re-derived verification state (no churn, no false publish)', async () => {
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

await t('check-site accepts a rebuilt feed carrying a verified ane-record', async () => {
  const { rec } = await build();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pubfeed-ane-'));
  try {
    fs.cpSync(siteRoot, tmp, { recursive: true, filter: src => path.basename(src) !== '.git' });
    const data = { ...liveFeed, generated_at: '2026-11-02T12:30:00Z', records: [rec, legacy] };
    data.policy = { ...liveFeed.policy, qualifies: qualifiesPolicy(data.records) };
    data.upstream_status = 'ok';
    fs.writeFileSync(path.join(tmp, 'publications/publications.json'), `${JSON.stringify(data, null, 2)}\n`);
    fs.writeFileSync(path.join(tmp, 'publications/index.html'), renderFeedPage(data));
    const home = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
    const s = '<!-- publications-latest:start -->', e = '<!-- publications-latest:end -->';
    fs.writeFileSync(path.join(tmp, 'index.html'), `${home.slice(0, home.indexOf(s) + s.length)}\n${renderIndexBlock(data)}\n${home.slice(home.indexOf(e))}`);
    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts/check-site.mjs')], { cwd: tmp, encoding: 'utf8' });
    assert.equal(run.status, 0, `check-site failed:\n${run.stderr}`);
    assert.ok(run.stdout.includes('PASS publications feed reviewed research records are bound, labelled and verified'));
    assert.ok(run.stdout.includes('PASS publications page shows each reviewed research record with its bindings and scope label'));
    // Negative control: a same-chip rerun presented as cross-device replication must fail the site check.
    data.records[0] = { ...rec, replication: { ...rec.replication, cross_device_replication: true } };
    fs.writeFileSync(path.join(tmp, 'publications/publications.json'), `${JSON.stringify(data, null, 2)}\n`);
    const bad = spawnSync(process.execPath, [path.join(tmp, 'scripts/check-site.mjs')], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(bad.status, 0, 'check-site accepted a same-chip rerun labelled as cross-device replication');
    assert.match(bad.stderr, /a same-chip rerun must never count as cross-device replication/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`ane-record feed tests: ${ran - failed}/${ran} passed`);
if (failed) process.exitCode = 1;
