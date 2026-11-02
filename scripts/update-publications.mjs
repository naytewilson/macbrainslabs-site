#!/usr/bin/env node
// Regenerates the /publications/ release feed from the upstream archive
// repository (macbrainslabs/ane-research-records) at rebuild time.
//
// Dependency-free (Node >= 22, global fetch). Safety properties:
//   1. Nothing is written unless every upstream record passes structural
//      validation, so a failed rebuild keeps the last-known-good files.
//   2. Verification states are re-derived here, never copied: release assets
//      are downloaded and hashed, manifest fingerprints are compared against
//      the pinned site-commit bytes on GitHub, and DOI claims are
//      cross-checked against the Zenodo registration API.
//   3. Release prose is deliberately never rendered; only validated structured
//      fields reach the page. Every URL is validated against a host
//      allowlist before it can appear as a link; rejected URLs degrade the
//      record instead of silently dropping the claim.
//   4. The public feed carries only independently verified records: if ANY
//      rebuilt record is not fully verified — a previously verified record
//      re-deriving degraded (even over changed upstream data), or a new
//      record that is not fully verified — the whole update is held and the
//      deployed last-known-good snapshot stays. The data core omits
//      re-derived verification state, but core changes only matter when
//      everything still verifies; they never lower the verification bar.
//
//   5. Reviewed research records (tags ane-record-<24 hex>) are built by a
//      separate builder: four release assets re-hashed against registered
//      digests, the canonical review package and INCLUDE verdict at the tag
//      bound to the records index, and the Zenodo version bound to the tag.
//      A version not minted yet is degraded, so rule 4 holds the update.
//
// Exit codes: 0 wrote changed/changed-state output, or already current;
// 1 structural failure (never commit); 2 upstream unreachable or the
// last-known-good decision held the update (keep last-known-good).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE = 'https://macbrainslabs.org';
const RELEASES_REPO = 'macbrainslabs/ane-research-records';
const RELEASES_ENDPOINT = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=100`;
const SITE_REPO = 'naytewilson/macbrainslabs-site';
const SITE_REPO_URL = `https://github.com/${SITE_REPO}`;
const SITE_REPO_NAME = 'macbrainslabs-site';
const TAG_RX = /^v[0-9]+\.[0-9]+\.[0-9]+$/u;
const ANE_TAG_RX = /^ane-record-[0-9a-f]{24}$/u;
const ANE_KIND = 'ane-record';
const ANE_ASSET_NAMES = ['finding.json', 'citations.json', 'preview.md', 'manifest.json'];
const ANE_INDEX_SCHEMA = 'macbrains.dataset.records-index.v1';
const ANE_REVIEW_PACKAGE_SCHEMA = 'macbrains.research.final-review-package.v1';
const ANE_FINAL_REVIEWER = 'macbrains-labs-reviewer';
const ANE_BASELINE_VERSION = 'v0.1.0';
const CONCEPT_DOI = '10.5281/zenodo.23798036';
const CONCEPT_RECID = '23798036';
const ZENODO_SEARCH_PAGE_SIZE = 25;
const ZENODO_SEARCH_MAX_PAGES = 40;
const ID_RX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA_RX = /^[a-f0-9]{64}$/u;
const MANIFEST_SCHEMA = '1.0';
const RESEARCHER_NAME = 'Nayte Wilson';
const RESEARCHER_ORCID = '0009-0003-4026-8212';
const PUBLISHER_IDENTITY = 'MacBrains Labs (independent)';
const ZENODO_LICENSE = 'cc-by-4.0';
const SOURCE_FILE_PREFIXES = ['notes/', 'methods/', 'research/', 'evidence/', 'security/'];
const LINK_HOSTS = ['github.com', 'zenodo.org', 'doi.org', 'macbrainslabs.org', 'orcid.org'];
const ASSET_HOSTS = ['github.com', 'objects.githubusercontent.com'];
const RAW_HOST = 'raw.githubusercontent.com';
const MAX_RECORDS = 48;
const MAX_SOURCE_FILES = 16;
const MAX_EVIDENCE_LIMITS = 12;
const TEXT_MAX = 400;

const root = process.cwd();
const feedDir = path.join(root, 'publications');
const feedJsonPath = path.join(feedDir, 'publications.json');
const feedHtmlPath = path.join(feedDir, 'index.html');
const homePath = path.join(root, 'index.html');
const markers = { start: '<!-- publications-latest:start -->', end: '<!-- publications-latest:end -->' };

const output = (...a) => console.log('[publications]', ...a);
const die = (code, msg) => { console.error(`[publications] FATAL (${code}): ${msg}`); process.exit(code); };

const assert = Object.assign(
  (cond, msg) => { if (!cond) throw new Error(msg); },
  {
    ok: (cond, msg) => { if (!cond) throw new Error(msg); },
    equal: (a, b, msg) => { if (a !== b) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    fail: msg => { throw new Error(msg); }
  }
);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cleanText(v, what, max = TEXT_MAX) {
  const s = typeof v === 'string' ? v.trim() : '';
  assert.ok(s.length > 0 && s.length <= max, `${what}: empty or over ${max} chars`);
  for (const ch of s) {
    const c = ch.codePointAt(0);
    assert.ok(!(c < 0x20 || c === 0x7f || ch === '<' || ch === '>' || ch === '"'), `${what}: contains a control, angle or quote character`);
  }
  return s;
}

function isoNow() { return `${new Date().toISOString().slice(0, 19)}Z`; }

function humanDate(iso) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = iso.match(/^(\d{4})-(\d\d)-(\d\d)/);
  assert.ok(m, `bad date ${iso}`);
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function fetchOpts(kind) {
  const o = { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'macbrainslabs-site-publications-feed' } };
  if (kind === 'gh') {
    o.headers.Accept = 'application/vnd.github+json';
    if (process.env.GITHUB_TOKEN) o.headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else if (kind === 'asset') {
    // Release-asset bytes must never be negotiated as API JSON: GitHub's CDN
    // may bounce a JSON-Accept request onto the asset API endpoint, which
    // would answer with asset metadata instead of file bytes.
    o.headers.Accept = 'application/octet-stream';
  }
  return o;
}

async function fetchBuf(url, kind) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, fetchOpts(kind));
      if (res.status === 200) return Buffer.from(await res.arrayBuffer());
      last = new Error(`HTTP ${res.status}${res.headers.get('x-ratelimit-remaining') === '0' ? ' (rate limit exhausted)' : ''}`);
      if (res.status === 404 || res.status === 410) { last.http = res.status; throw last; }
    } catch (e) {
      last = e;
      if (e.http) throw e;
    }
    if (i < 2) await new Promise(r => setTimeout(r, 1200 * (i + 1)));
  }
  throw last;
}

// An upstream fetch failure without an HTTP status is a reachability problem
// (degrade that specific element); anything else is structural (hard stop).
function unreachable(e) { return !e.http; }

function checkHost(urlStr, hosts, what) {
  assert.ok(typeof urlStr === 'string' && !urlStr.includes('\\') && !urlStr.includes(' ') && urlStr.length <= 2048, `${what}: malformed URL`);
  let u;
  try { u = new URL(urlStr); } catch { throw new Error(`${what}: unparseable URL`); }
  assert.equal(u.protocol, 'https:', `${what}: not https`);
  assert.ok(!u.username && !u.password, `${what}: userinfo in URL`);
  assert.ok(hosts.includes(u.host), `${what}: host ${u.host} not in the allowlist`);
  return u;
}

function attrsLink(href, label) {
  try { checkHost(href, LINK_HOSTS, 'feed link'); } catch { return `${esc(label)} (no link: URL failed validation)`; }
  return `<a href="${esc(href)}">${esc(label)}</a>`;
}

function mailLink() { return '<a href="mailto:research@macbrainslabs.org">research@macbrainslabs.org</a>'; }

function zenodoRecordId(urlStr, what) {
  const u = checkHost(urlStr, ['zenodo.org'], what);
  const m = u.pathname.match(/^\/records\/(\d+)\/?$/u);
  assert.ok(m, `${what}: not a zenodo record URL of the expected form`);
  return m[1];
}

function doiId(doi, what) {
  const m = String(doi).match(/^10\.5281\/zenodo\.(\d+)$/u);
  assert.ok(m, `${what}: not a Zenodo DOI of the expected form`);
  return m[1];
}

// -- upstream ----------------------------------------------------------------

async function loadReleases() {
  const buf = await fetchBuf(RELEASES_ENDPOINT, 'gh');
  let list;
  try { list = JSON.parse(buf.toString('utf8')); } catch (e) { die(1, `release endpoint returned invalid JSON: ${e.message}`); }
  assert.ok(Array.isArray(list), 'release endpoint did not return a list');
  return list;
}

function validateReleaseShell(rel, tagRx = TAG_RX) {
  assert.ok(rel && typeof rel === 'object', 'release entry is not an object');
  assert.ok(!rel.draft && !rel.prerelease, 'draft or prerelease');
  assert.ok(tagRx.test(rel.tag_name), `tag ${rel.tag_name} is not a published ${tagRx === ANE_TAG_RX ? 'ane-record-HEX24' : 'vX.Y.Z'} tag`);
  assert.ok(Number.isInteger(rel.id), `${rel.tag_name}: release id missing`);
  for (const k of ['name', 'html_url', 'published_at']) assert.ok(rel[k], `${rel.tag_name}: missing ${k}`);
  cleanText(rel.name, `release ${rel.tag_name} name`);
  checkHost(rel.html_url, ['github.com'], `${rel.tag_name} html_url`);
  assert.equal(rel.html_url, `https://github.com/${RELEASES_REPO}/releases/tag/${rel.tag_name}`, `${rel.tag_name}: html_url is not its own tag page`);
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(rel.published_at) && !isNaN(Date.parse(rel.published_at)), `${rel.tag_name}: published_at not ISO-UTC`);
}

async function verifyRelAssets(rel) {
  const assets = rel.assets ?? [];
  assert.ok(Array.isArray(assets) && assets.length === 2, `${rel.tag_name}: expected exactly two assets (archive + SHA256SUMS), got ${assets.length}`);
  const out = [];
  let sumsRef = null;
  for (const a of assets) {
    assert.ok(typeof a.name === 'string' && /^[A-Za-z0-9._-]+$/.test(a.name), `${rel.tag_name}: asset name ${a.name} unexpected form`);
    assert.ok(Number.isInteger(a.size) && a.size > 0 && a.size <= 64 * 1024 * 1024, `${rel.tag_name}: asset ${a.name} size out of bounds`);
    assert.ok(typeof a.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(a.digest), `${rel.tag_name}: asset ${a.name} lacks a registered sha256 digest`);
    const url = checkHost(a.browser_download_url, ASSET_HOSTS, `${rel.tag_name} asset ${a.name} url`);
    assert.equal(url.href, a.browser_download_url, `${rel.tag_name}: asset URL normalization mismatch`);
    out.push({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest });
    if (a.name === 'SHA256SUMS') sumsRef = a;
  }
  assert.ok(sumsRef, `${rel.tag_name}: no SHA256SUMS asset`);
  assert.ok(out[0].name !== 'SHA256SUMS', `${rel.tag_name}: archive asset is named SHA256SUMS`);

  const downloaded = new Map();
  const reasons = [];
  for (const a of out) {
    try {
      const bytes = await fetchBuf(a.url, 'asset');
      downloaded.set(a.name, sha256(bytes));
    } catch (e) {
      if (e.http) die(1, `${rel.tag_name}: asset ${a.name} acted missing (${e.message}); refusing to publish`);
      reasons.push(`asset ${a.name} could not be downloaded at rebuild`);
    }
  }
  if (!verifiedAll(downloaded, out)) return { assets: out, verified: false, reasons };

  try {
    const sumsBytes = await fetchBuf(sumsRef.url, 'asset');
    // The checksum file's own bytes must equal its GitHub-registered digest
    // (not all checksum files include a self-entry line — integrity comes
    // from the registered digest, not from file content).
    assert.equal(sha256(sumsBytes), sumsRef.digest.replace(/^sha256:/, ''), `${rel.tag_name}: SHA256SUMS bytes do not match its registered digest`);
    const map = new Map();
    for (const line of sumsBytes.toString('utf8').trim().split('\n')) {
      const m = line.match(/^([a-f0-9]{64})  ([^/\s]+)$/u);
      assert.ok(m, `${rel.tag_name}: malformed SHA256SUMS entry`);
      assert.ok(!map.has(m[2]), `${rel.tag_name}: duplicate SHA256SUMS entry ${m[2]}`);
      map.set(m[2], m[1]);
    }
    for (const a of out) {
      if (a.name === 'SHA256SUMS') continue;
      assert.ok(map.get(a.name), `${rel.tag_name}: SHA256SUMS lacks an entry for ${a.name}`);
      assert.equal(map.get(a.name), downloaded.get(a.name), `${rel.tag_name}: ${a.name} digest disagrees with SHA256SUMS`);
    }
    assert.ok([...map.keys()].every(k => out.some(a => a.name === k)), `${rel.tag_name}: SHA256SUMS lists assets that are not part of the release`);
    return { assets: out, verified: true, reasons };
  } catch (e) {
    // Distinguish hard verification failures from reachability failures:
    // a malformed or non-conforming checksum file is a structural refusal,
    // never a degraded publish.
    if (e.http) die(1, `${rel.tag_name}: SHA256SUMS acted missing (${e.message}); refusing to publish`);
    if (e.message.includes('unparseable URL') || e.message.includes('HTTP')) {
      reasons.push('SHA256SUMS could not be fetched at rebuild');
      return { assets: out, verified: false, reasons };
    }
    die(1, `${rel.tag_name}: SHA256SUMS verification failed: ${e.message}`);
  }

  function verifiedAll(d, list) {
    return list.length > 0 && list.every(a => d.has(a.name));
  }
}

async function loadManifestAtTag(tag) {
  const raw = await fetchBuf(`https://api.github.com/repos/${RELEASES_REPO}/contents/manifest.json?ref=${encodeURIComponent(tag)}`, 'gh');
  const item = JSON.parse(raw.toString('utf8'));
  assert.equal(item.encoding, 'base64', 'manifest.json contents item not base64');
  const text = Buffer.from(String(item.content).replace(/\s/g, ''), 'base64').toString('utf8');
  let m;
  try { m = JSON.parse(text); } catch (e) { throw new Error(`manifest at ${tag} is not valid JSON: ${e.message}`); }
  return m;
}

function pinnedPath(sitePath) {
  const p = String(sitePath);
  assert.ok(p.length < 200 && !p.startsWith('/') && !p.includes('\0'), `bad source path ${p}`);
  for (const seg of p.split('/')) {
    assert.ok(seg && seg !== '.' && seg !== '..' && /^[A-Za-z0-9._-]+$/.test(seg), `source path ${p} has an unsafe segment`);
  }
  assert.ok(SOURCE_FILE_PREFIXES.some(pre => p.startsWith(pre)), `source path ${p} outside allowlisted prefixes`);
  assert.ok(p.endsWith('.html'), `source path ${p} is not an archived HTML document`);
  return p;
}

async function checkFingerprints(manifest, rel) {
  const files = manifest.source_files;
  assert.ok(files && typeof files === 'object' && !Array.isArray(files), `${rel.tag_name}: manifest source_files missing`);
  const keys = Object.keys(files);
  assert.ok(keys.length >= 1 && keys.length <= MAX_SOURCE_FILES, `${rel.tag_name}: source_files count out of bounds`);
  const out = [];
  for (const p of keys.sort()) {
    const entry = files[p];
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), `${rel.tag_name}: source_files.${p} malformed`);
    const fsPath = pinnedPath(p);
    assert.ok(SHA_RX.test(entry.sha256), `${rel.tag_name}: fingerprint for ${p} is not lowercase sha256 hex`);
    checkHost(entry.url, ['macbrainslabs.org'], `${rel.tag_name} source url ${p}`);
    const expectedUrl = (fsPath === 'index.html' || fsPath.endsWith('/index.html'))
      ? `${BASE}/${fsPath.slice(0, -'index.html'.length)}`
      : `${BASE}/${fsPath}`;
    assert.equal(entry.url, expectedUrl, `${rel.tag_name}: source url for ${p} does not match its path`);
    let state;
    try {
      const bytes = await fetchBuf(`https://${RAW_HOST}/${SITE_REPO}/${manifest.site_commit}/${p}`, 'raw');
      state = sha256(bytes) === entry.sha256 ? 'match' : 'mismatch';
    } catch (e) {
      if (e.http) throw new Error(`${rel.tag_name}: fingerprint target ${p} missing at pinned commit (${e.message})`);
      state = 'unreachable';
    }
    out.push({ path: fsPath, url: entry.url, sha256: entry.sha256, fingerprint_check: state });
  }
  return out;
}

function basicManifestChecks(manifest, rel) {
  assert.ok(manifest && typeof manifest === 'object', `${rel.tag_name}: manifest is not an object`);
  assert.equal(manifest.schema_version, MANIFEST_SCHEMA, `${rel.tag_name}: manifest schema_version unsupported`);
  assert.equal(manifest.site_repository, SITE_REPO_URL, `${rel.tag_name}: manifest site_repository is not the site repository`);
  assert.ok(/^[a-f0-9]{40}$/.test(manifest.site_commit), `${rel.tag_name}: site_commit not a full sha`);
  assert.equal(manifest.authors_public_name, RESEARCHER_NAME, `${rel.tag_name}: authors_public_name mismatch`);
  assert.equal(manifest.publisher_identity, PUBLISHER_IDENTITY, `${rel.tag_name}: publisher_identity mismatch`);
  cleanText(manifest.release_title, `${rel.tag_name} manifest release_title`, 300);
  cleanText(manifest.record_class, `${rel.tag_name} manifest record_class`, 200);
  const limits = manifest.evidence_limits;
  assert.ok(Array.isArray(limits) && limits.length >= 1 && limits.length <= MAX_EVIDENCE_LIMITS, `${rel.tag_name}: evidence_limits malformed`);
  return limits.map(l => cleanText(l, `${rel.tag_name} evidence limit`, 300));
}

// Parse the exact subset of CITATION.cff this workflow relies on.
function parseCitation(text, what) {
  const out = {};
  const doi = text.match(/^doi:\s*"?([0-9]+\.[0-9]+\/[\w.()\/"#:-]+[0-9])"?\s*$/mu);
  const version = text.match(/^version:\s*"?(v?[0-9]+\.[0-9]+\.[0-9]+)"?\s*$/mu);
  const date = text.match(/^date-released:\s*"?(\d{4}-\d\d-\d\d)"?\s*$/mu);
  assert.ok(doi, `${what}: no doi line of the expected form`);
  assert.ok(version, `${what}: no version line of the expected form`);
  assert.ok(date, `${what}: no date-released line of the expected form`);
  out.doi = doi[1];
  out.version = version[1];
  out.date_released = date[1];
  return out;
}

async function resolveDoi(manifest, rel) {
  const tag = rel.tag_name;
  const limits = basicManifestChecks(manifest, rel);
  // Archival provenance: the status string the tagged manifest itself carried.
  // It is never used to describe the CURRENT DOI state — that is derived from
  // the cross-check below (registered_state) — but it is preserved verbatim.
  const taggedManifestDoiStatus = cleanText(manifest.doi_status, `${tag} doi_status in the tagged manifest`, 300);

  // Path A: the manifest at the tag itself carries a DOI binding.
  if (typeof manifest.version_doi === 'string' || typeof manifest.concept_doi === 'string' || typeof manifest.zenodo_record_url === 'string') {
    assert.ok(doiId(manifest.version_doi, `${tag} version_doi`), 'version_doi malformed');
    assert.ok(doiId(manifest.concept_doi, `${tag} concept_doi`), 'concept_doi malformed');
    assert.notEqual(doiId(manifest.version_doi, 'v'), doiId(manifest.concept_doi, 'c'), `${tag}: version and concept DOI collide`);
    const recordId = zenodoRecordId(manifest.zenodo_record_url, `${tag} zenodo_record_url`);
    assert.equal(recordId, doiId(manifest.version_doi, 'v'), `${tag}: zenodo record id does not match the version DOI`);
    assert.ok(manifest.release_tag === undefined || manifest.release_tag === tag, `${tag}: manifest release_tag does not match the release`);
    const cc = await crosscheckZenodo(manifest.version_doi, manifest.concept_doi, manifest.release_title, rel.published_at.slice(0, 10), null);
    return {
      version_doi: manifest.version_doi,
      concept_doi: manifest.concept_doi,
      zenodo_record_url: manifest.zenodo_record_url,
      tagged_manifest_doi_status: taggedManifestDoiStatus,
      binding_source: 'manifest at the tag',
      source_detail: 'the DOI binding comes from manifest.json fetched at this exact tag',
      crosscheck: cc,
      evidence_limits: limits
    };
  }

  // Path B: the tagged manifest recorded no DOI at release time. Resolve a
  // candidate from CITATION.cff on main, then require the Zenodo registration
  // itself to bind that DOI to this exact tag, date, title and ORCID/license.
  assert.ok(/^not issued/.test(taggedManifestDoiStatus), `${tag}: manifest carries no DOI fields and doi_status does not state "not issued"` +
    ' — refusing to invent one');
  const raw = await fetchBuf(`https://api.github.com/repos/${RELEASES_REPO}/contents/CITATION.cff?ref=main`, 'gh');
  const item = JSON.parse(raw.toString('utf8'));
  assert.equal(item.encoding, 'base64', 'CITATION.cff contents item not base64');
  const cff = parseCitation(Buffer.from(String(item.content).replace(/\s/g, ''), 'base64').toString('utf8'), `${tag} citation file`);
  assert.equal(cff.version.startsWith('v') ? cff.version.slice(1) : cff.version, tag.slice(1), `${tag}: citation file version does not correspond to this tag; refusing to bind a DOI`);
  let rec;
  const candidate = cff.doi;
  try {
    const buf = await fetchBuf(`https://zenodo.org/api/records/${doiId(candidate, 'citation doi')}`, 'zenodo');
    rec = JSON.parse(buf.toString('utf8'));
    assert.ok(rec && rec.metadata && typeof rec.metadata === 'object', 'zenodo record malformed');
  } catch (e) {
    if (e.http) throw new Error(`zenodo candidate DOI ${candidate} failed structurally: ${e.message}`);
    return {
      version_doi: null, concept_doi: null, zenodo_record_url: null,
      tagged_manifest_doi_status: taggedManifestDoiStatus,
      binding_source: 'not issued',
      source_detail: 'the archive repository could not be reached to re-derive the registered DOI at rebuild; no DOI claim is published',
      crosscheck: { state: 'unreachable', comparisons: null, detail: 'the Zenodo registration could not be fetched at rebuild time' },
      evidence_limits: limits
    };
  }
  const relates = (rec.metadata.related_identifiers ?? []).filter(x => x && typeof x.identifier === 'string' && x.identifier.startsWith(`https://github.com/${RELEASES_REPO}/tree/`)).map(x => x.identifier);
  const bindsTag = rec.metadata.version === tag || relates.includes(`https://github.com/${RELEASES_REPO}/tree/${tag}`);
  const bindsRepo = (rec.metadata.custom && typeof rec.metadata.custom === 'object' && rec.metadata.custom['code:codeRepository'] === `https://github.com/${RELEASES_REPO}`) || relates.length > 0;
  const comparisons = {
    version_doi: rec.doi === candidate ? 'match' : 'mismatch',
    record_version_tag: bindsTag ? 'match' : 'mismatch',
    archive_reference: bindsRepo ? 'match' : 'mismatch',
    title: rec.metadata.title === manifest.release_title ? 'match' : 'mismatch',
    publication_date: rec.metadata.publication_date === rel.published_at.slice(0, 10) ? 'match' : 'mismatch',
    creator_orcid: (rec.metadata.creators ?? []).some(x => x && typeof x === 'object' && x.orcid === RESEARCHER_ORCID) ? 'match' : 'mismatch',
    license: (rec.metadata.license && typeof rec.metadata.license === 'object' && rec.metadata.license.id === ZENODO_LICENSE) ? 'match' : 'mismatch'
  };
  const failed = Object.entries(comparisons).filter(([, v]) => v === 'mismatch').map(([k]) => k);
  return {
    version_doi: candidate,
    concept_doi: typeof rec.conceptdoi === 'string' && doiId(rec.conceptdoi, 'concept doi') ? rec.conceptdoi : null,
    zenodo_record_url: `https://zenodo.org/records/${doiId(candidate, 'candidate')}`,
    tagged_manifest_doi_status: taggedManifestDoiStatus,
    binding_source: 'citation file at main',
    source_detail: 'the tagged manifest recorded no DOI at release time; the candidate DOI comes from the citation file on main and was accepted only because the Zenodo registration binds it to this tag',
    crosscheck: { state: failed.length ? 'mismatch' : 'pass', comparisons, detail: failed.length ? `registration disagrees on: ${failed.join(', ')}` : null },
    evidence_limits: limits
  };
}

async function crosscheckZenodo(versionDoi, conceptDoi, title, publishedDate, metadataVersionTag) {
  const id = doiId(versionDoi, 'version_doi');
  let rec;
  try {
    const buf = await fetchBuf(`https://zenodo.org/api/records/${id}`, 'zenodo');
    rec = JSON.parse(buf.toString('utf8'));
    assert.ok(rec && rec.metadata && typeof rec.metadata === 'object', 'zenodo record malformed');
  } catch (e) {
    if (e.http) throw new Error(`zenodo record ${id} failed structurally: ${e.message}`);
    return { state: 'unreachable', comparisons: null, detail: 'the Zenodo registration could not be fetched at rebuild time' };
  }
  const c = {
    version_doi: rec.doi === versionDoi ? 'match' : 'mismatch',
    concept_doi: rec.conceptdoi === conceptDoi ? 'match' : 'mismatch',
    title: rec.metadata.title === title ? 'match' : 'mismatch',
    publication_date: rec.metadata.publication_date === publishedDate ? 'match' : 'mismatch',
    creator_orcid: (rec.metadata.creators ?? []).some(x => x && typeof x === 'object' && x.orcid === RESEARCHER_ORCID) ? 'match' : 'mismatch',
    license: (rec.metadata.license && typeof rec.metadata.license === 'object' && rec.metadata.license.id === ZENODO_LICENSE) ? 'match' : 'mismatch'
  };
  if (metadataVersionTag !== null) {
    c.record_version_tag = rec.metadata.version === metadataVersionTag ? 'match' : 'mismatch';
  }
  const failed = Object.entries(c).filter(([, v]) => v !== 'match').map(([k]) => k);
  return { state: failed.length ? 'mismatch' : 'pass', comparisons: c, detail: failed.length ? `registration disagrees on: ${failed.join(', ')}` : null };
}

// -- record assembly ---------------------------------------------------------

async function buildRecord(rel) {
  const relAssets = await verifyRelAssets(rel);
  const guards = [{ name: 'published release tag', state: 'pass' }];

  const manifest = await loadManifestAtTag(rel.tag_name);
  const doi = await resolveDoi(manifest, rel);
  const evidenceLimits = doi.evidence_limits;
  guards.push({ name: 'manifest at the tag (schema 1.0: fingerprints, limits and DOI state)', state: 'pass' });
  guards.push({
    name: `DOI binding resolved from: ${doi.binding_source}`,
    state: doi.version_doi ? 'pass' : 'degraded',
    detail: doi.version_doi ? doi.source_detail : doi.source_detail
  });

  const digOk = relAssets.verified;
  guards.push({
    name: 'release assets re-downloaded; byte digests and SHA256SUMS agree',
    state: digOk ? 'pass' : 'degraded',
    detail: digOk ? null : relAssets.reasons.join('; ') || null
  });

  const pages = await checkFingerprints(manifest, rel);
  const matched = pages.filter(p => p.fingerprint_check === 'match').length;
  const mm = pages.filter(p => p.fingerprint_check === 'mismatch').length;
  const un = pages.filter(p => p.fingerprint_check === 'unreachable').length;
  guards.push({
    name: `source document fingerprints re-derived at the pinned commit (${matched}/${pages.length})`,
    state: matched === pages.length ? 'pass' : 'degraded',
    detail: matched === pages.length ? null : [mm ? `${mm} mismatch against the pinned commit` : null, un ? `${un} unreachable at rebuild` : null].filter(Boolean).join('; ')
  });

  guards.push({
    name: 'DOI registration cross-checked against Zenodo (identity, title, date, ORCID, license)',
    state: doi.crosscheck.state === 'pass' ? 'pass' : 'degraded',
    detail: doi.crosscheck.state === 'pass' ? null : doi.crosscheck.detail
  });

  const state = guards.every(g => g.state === 'pass') ? 'verified' : 'degraded';
  // The current registered DOI state is derived exclusively from the re-check
  // result, never from the archived manifest text.
  const registered_state = doi.version_doi
    ? ({ pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now' }[doi.crosscheck.state] ?? 'unverifiable_now')
    : 'none';
  return {
    tag: rel.tag_name,
    release_name: rel.name,
    published_at: rel.published_at,
    release_url: rel.html_url,
    record_class: manifest.record_class,
    zenodo_title: manifest.release_title,
    record_repository: `https://github.com/${RELEASES_REPO}`,
    provenance: {
      site_repository: manifest.site_repository,
      site_commit: manifest.site_commit,
      source_pages: pages
    },
    doi: {
      version_doi: doi.version_doi,
      concept_doi: doi.concept_doi,
      zenodo_record_url: doi.zenodo_record_url,
      tagged_manifest_doi_status: doi.tagged_manifest_doi_status,
      binding_source: doi.binding_source,
      registered_state,
      crosscheck: { state: doi.crosscheck.state, comparisons: doi.crosscheck.comparisons, detail: doi.crosscheck.detail }
    },
    assets: relAssets.assets.map(a => ({
      name: a.name,
      url: a.url,
      size: a.size,
      digest: a.digest,
      sha256: digOk ? a.digest.replace(/^sha256:/, '') : null
    })),
    sha256_sums: { verified: digOk },
    evidence_limits: evidenceLimits,
    verification: { state, guards }
  };
}

// -- reviewed research records (ane-record-*) --------------------------------
//
// The publication pipeline publishes reviewed research records as releases
// tagged ane-record-<first 24 hex of sha256(publicationId)>. They carry exactly
// four public assets (no archive, no SHA256SUMS). Their verification chain
// lives in the archive repository at the release tag: records/index.json lists
// the record, and records/<tag>/ holds the canonical review package and the
// final verdict. Every guard must pass for state "verified"; anything else is
// degraded, and the last-known-good rule then holds the whole update. Release
// prose (including the machine marker in the body) is never read or rendered.

const QUALIFIES_LEGACY = 'a published GitHub release tag vX.Y.Z of the configured archive repository whose manifest.json (schema 1.0) at that tag validates; draft and prerelease releases are structurally excluded';
const QUALIFIES_WITH_RECORDS = 'a published GitHub release of the configured archive repository: either tag vX.Y.Z whose manifest.json (schema 1.0) at that tag validates, or a reviewed research record tagged ane-record- plus 24 hex digits whose four assets re-hash to their registered digests, whose canonical review package at the tag hashes to its records index entry and lists those digests, whose final verdict is INCLUDE from macbrains-labs-reviewer, and whose Zenodo version is bound to the tag; draft and prerelease releases are structurally excluded';

// The policy text describes exactly the record kinds the feed carries, so a
// feed of vX.Y.Z records alone keeps its previous bytes.
export function qualifiesPolicy(records) {
  return records.some(r => r.kind === ANE_KIND) ? QUALIFIES_WITH_RECORDS : QUALIFIES_LEGACY;
}

// Canonical JSON as the publication pipeline writes it: object keys sorted
// recursively, no whitespace.
function canonicalJSON(value) {
  const stable = x => {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
    if (typeof x === 'number') {
      assert.ok(Number.isFinite(x), 'non-finite number in canonical JSON');
      return Object.is(x, -0) ? 0 : x;
    }
    assert.ok(typeof x === 'object', 'unsupported value in canonical JSON');
    if (Array.isArray(x)) return x.map(stable);
    const out = Object.create(null);
    for (const k of Object.keys(x).sort()) out[k] = stable(x[k]);
    return out;
  };
  return JSON.stringify(stable(value));
}

async function loadRepoFileAtTag(repoPath, tag) {
  const raw = await fetchBuf(`https://api.github.com/repos/${RELEASES_REPO}/contents/${repoPath}?ref=${encodeURIComponent(tag)}`, 'gh');
  let item;
  try { item = JSON.parse(raw.toString('utf8')); } catch { throw new Error(`${repoPath} at ${tag}: contents response is not JSON`); }
  assert.ok(item && item.encoding === 'base64' && typeof item.content === 'string', `${repoPath} at ${tag}: contents item not base64`);
  return Buffer.from(item.content.replace(/\s/g, ''), 'base64');
}

function aneIndexEntry(buf, tag) {
  let index;
  try { index = JSON.parse(buf.toString('utf8')); } catch { throw new Error(`${tag}: records/index.json at the tag is not valid JSON`); }
  assert.ok(index && typeof index === 'object' && !Array.isArray(index), `${tag}: records index is not an object`);
  assert.equal(index.schema, ANE_INDEX_SCHEMA, `${tag}: records index schema unsupported`);
  assert.equal(index.conceptDoi, CONCEPT_DOI, `${tag}: records index all-versions DOI`);
  assert.ok(index.baseline && typeof index.baseline === 'object' && index.baseline.version === ANE_BASELINE_VERSION, `${tag}: records index baseline is not ${ANE_BASELINE_VERSION}`);
  assert.ok(Array.isArray(index.records), `${tag}: records index has no records list`);
  const hits = index.records.filter(r => r && typeof r === 'object' && r.tag === tag);
  assert.equal(hits.length, 1, `${tag}: records index entries for this tag`);
  const e = hits[0];
  assert.ok(typeof e.version === 'string' && TAG_RX.test(e.version), `${tag}: index version is not vX.Y.Z`);
  cleanText(e.title, `${tag} index title`, 300);
  assert.ok(typeof e.publicationId === 'string' && ID_RX.test(e.publicationId), `${tag}: index publicationId malformed`);
  for (const k of ['packageHash', 'reviewPackageHash', 'verdictDigest']) assert.ok(SHA_RX.test(e[k]), `${tag}: index ${k} is not lowercase sha256 hex`);
  assert.equal(e.path, `records/${tag}/`, `${tag}: index path`);
  assert.ok(typeof e.releasedOn === 'string' && /^\d{4}-\d\d-\d\d$/u.test(e.releasedOn) && !isNaN(Date.parse(e.releasedOn)), `${tag}: index releasedOn is not a date`);
  const r = e.replication;
  assert.ok(r && typeof r === 'object' && !Array.isArray(r), `${tag}: index replication missing`);
  assert.ok(['same-chip', 'cross-device'].includes(r.scope), `${tag}: replication scope unsupported`);
  cleanText(r.claim, `${tag} replication claim`, 300);
  assert.ok(SHA_RX.test(r.profileHash), `${tag}: replication profileHash is not lowercase sha256 hex`);
  for (const k of ['runCount', 'passCount', 'failCount']) assert.ok(Number.isSafeInteger(r[k]) && r[k] >= 0, `${tag}: replication ${k} malformed`);
  assert.ok(r.runCount >= 1 && r.passCount + r.failCount === r.runCount, `${tag}: replication pass and fail counts do not add up to the runs kept`);
  assert.equal(e.siteUrl, `${BASE}/research/records/${tag}/`, `${tag}: index siteUrl is not this record's page`);
  checkHost(e.siteUrl, ['macbrainslabs.org'], `${tag} siteUrl`);
  if (e.versionDoi !== undefined) doiId(e.versionDoi, `${tag} index versionDoi`);
  return e;
}

async function verifyAneAssets(rel) {
  const tag = rel.tag_name;
  const list = rel.assets ?? [];
  assert.ok(Array.isArray(list) && list.length === ANE_ASSET_NAMES.length, `${tag}: expected exactly four assets (${ANE_ASSET_NAMES.join(', ')}), got ${Array.isArray(list) ? list.length : 'none'}`);
  const out = [];
  for (const name of ANE_ASSET_NAMES) {
    const found = list.filter(a => a && a.name === name);
    assert.equal(found.length, 1, `${tag}: count of asset ${name}`);
    const a = found[0];
    assert.ok(Number.isInteger(a.size) && a.size > 0 && a.size <= 64 * 1024 * 1024, `${tag}: asset ${name} size out of bounds`);
    assert.ok(typeof a.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(a.digest), `${tag}: asset ${name} lacks a registered sha256 digest`);
    const url = checkHost(a.browser_download_url, ASSET_HOSTS, `${tag} asset ${name} url`);
    assert.equal(url.href, `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${name}`, `${tag}: asset ${name} url is not this release's download URL`);
    out.push({ name, url: url.href, size: a.size, digest: a.digest });
  }
  const reasons = [];
  const matched = new Set();
  for (const a of out) {
    let bytes;
    try { bytes = await fetchBuf(a.url, 'asset'); } catch (e) {
      if (e.http) throw new Error(`${tag}: asset ${a.name} acted missing (${e.message}); refusing to publish`);
      reasons.push(`asset ${a.name} could not be downloaded at rebuild`);
      continue;
    }
    if (sha256(bytes) !== a.digest.slice('sha256:'.length)) reasons.push(`asset ${a.name}: downloaded bytes do not hash to the registered digest`);
    else if (bytes.length !== a.size) reasons.push(`asset ${a.name}: downloaded size differs from the registered size`);
    else matched.add(a.name);
  }
  return {
    assets: out.map(a => ({ ...a, sha256: matched.has(a.name) ? a.digest.slice('sha256:'.length) : null })),
    verified: reasons.length === 0,
    reasons
  };
}

async function checkAneReviewPackage(tag, entry, assets) {
  let buf;
  try { buf = await loadRepoFileAtTag(`records/${tag}/review-package.json`, tag); } catch (e) {
    if (e.http) throw new Error(`${tag}: review-package.json missing at the tag (${e.message})`);
    return { ok: false, detail: 'the review package could not be fetched at rebuild' };
  }
  const problems = [];
  const text = buf.toString('utf8');
  if (!text.endsWith('\n') || text.endsWith('\n\n')) problems.push('file is not canonical text plus exactly one newline');
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  let rp = null;
  try { rp = JSON.parse(body); } catch { problems.push('not valid JSON'); }
  if (rp !== null) {
    let canonical = null;
    try { canonical = canonicalJSON(rp); } catch { /* reported below */ }
    if (canonical !== body) problems.push('not canonical JSON');
    if (sha256(Buffer.from(body, 'utf8')) !== entry.reviewPackageHash) problems.push('sha256 differs from the records index entry');
    const obj = rp && typeof rp === 'object' && !Array.isArray(rp) ? rp : {};
    if (obj.schema !== ANE_REVIEW_PACKAGE_SCHEMA) problems.push('review package schema unsupported');
    const pub = obj.publication && typeof obj.publication === 'object' ? obj.publication : {};
    if (pub.releaseTag !== tag) problems.push('release tag differs');
    if (pub.publicationId !== entry.publicationId) problems.push('publication id differs from the index entry');
    if (pub.packageHash !== entry.packageHash) problems.push('package hash differs from the index entry');
    const files = Array.isArray(pub.files) ? pub.files : [];
    const filesOk = files.length === assets.length && new Set(files.map(f => f && f.name)).size === files.length &&
      assets.every(a => files.some(f => f && f.name === a.name && f.sha256 === a.digest.slice('sha256:'.length) && f.bytes === a.size));
    if (!filesOk) problems.push('publication files do not equal the four registered asset digests and sizes');
    const rr = obj.replication && typeof obj.replication === 'object' ? obj.replication : {};
    const rf = ['scope', 'claim', 'profileHash', 'runCount', 'passCount', 'failCount'].filter(k => rr[k] !== entry.replication[k]);
    if (rf.length) problems.push(`replication differs from the index entry on: ${rf.join(', ')}`);
    const tg = obj.targets && typeof obj.targets === 'object' ? obj.targets : {};
    if (tg.siteUrl !== entry.siteUrl || tg.conceptDoi !== CONCEPT_DOI) problems.push('targets differ from the index entry');
  }
  if (sha256(Buffer.from(entry.publicationId, 'utf8')).slice(0, 24) !== tag.slice('ane-record-'.length)) problems.push('release tag is not derived from the publication id');
  return { ok: problems.length === 0, detail: problems.length ? problems.join('; ') : null };
}

async function checkAneVerdict(tag, entry) {
  let buf;
  try { buf = await loadRepoFileAtTag(`records/${tag}/final-verdict.json`, tag); } catch (e) {
    if (e.http) throw new Error(`${tag}: final-verdict.json missing at the tag (${e.message})`);
    return { ok: false, decision: 'unknown', detail: 'the final verdict could not be fetched at rebuild' };
  }
  let v;
  try { v = JSON.parse(buf.toString('utf8')); } catch { return { ok: false, decision: 'unknown', detail: 'final verdict is not valid JSON' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, decision: 'unknown', detail: 'final verdict is not an object' };
  const decision = v.decision === 'INCLUDE' || v.decision === 'HOLD' ? v.decision : 'unknown';
  const problems = [];
  if (v.reviewer !== ANE_FINAL_REVIEWER) problems.push(`reviewer is not ${ANE_FINAL_REVIEWER}`);
  if (decision !== 'INCLUDE') problems.push(`decision is ${decision}, not INCLUDE`);
  if (v.reviewPackageHash !== entry.reviewPackageHash) problems.push('verdict is for a different review package hash');
  if (v.verdictDigest !== entry.verdictDigest) problems.push('verdict digest differs from the records index entry');
  const { verdictDigest: claimed, ...body } = v;
  let rederived = null;
  try { rederived = sha256(Buffer.from(canonicalJSON(body), 'utf8')); } catch { /* reported below */ }
  if (rederived !== claimed) problems.push('verdict digest does not re-derive from the verdict body');
  return { ok: problems.length === 0, decision, detail: problems.length ? problems.join('; ') : null };
}

// All Zenodo versions under the all-versions concept, paged (unauthenticated
// search caps the page size at 25). Fetched once per rebuild.
let zenodoVersionsMemo = null;
function zenodoConceptVersions() {
  zenodoVersionsMemo ??= (async () => {
    const hits = [];
    for (let page = 1; page <= ZENODO_SEARCH_MAX_PAGES; page++) {
      const buf = await fetchBuf(`https://zenodo.org/api/records?q=conceptrecid:${CONCEPT_RECID}&allversions=true&sort=newest&size=${ZENODO_SEARCH_PAGE_SIZE}&page=${page}`, 'zenodo');
      const j = JSON.parse(buf.toString('utf8'));
      const batch = j && j.hits && j.hits.hits;
      assert.ok(Array.isArray(batch), 'zenodo version search response malformed');
      hits.push(...batch);
      if (batch.length < ZENODO_SEARCH_PAGE_SIZE || hits.length >= (Number(j.hits.total) || 0)) break;
    }
    return hits;
  })();
  return zenodoVersionsMemo;
}
export function resetZenodoCache() { zenodoVersionsMemo = null; }

async function crosscheckAneZenodo(tag, entry) {
  const treeUrl = `https://github.com/${RELEASES_REPO}/tree/${tag}`;
  let hits;
  try { hits = await zenodoConceptVersions(); } catch (e) {
    if (e.http) throw new Error(`zenodo version search failed structurally: ${e.message}`);
    return { state: 'unreachable', version_doi: null, comparisons: null, detail: 'the Zenodo version search could not be completed at rebuild time' };
  }
  const bound = hits.filter(h => h && typeof h === 'object' && h.metadata && typeof h.metadata === 'object' &&
    Array.isArray(h.metadata.related_identifiers) && h.metadata.related_identifiers.some(x => x && x.identifier === treeUrl));
  if (bound.length === 0) return { state: 'not_minted', version_doi: null, comparisons: null, detail: 'Zenodo has not minted a version bound to this release tag yet' };
  if (bound.length > 1) return { state: 'mismatch', version_doi: null, comparisons: null, detail: `${bound.length} Zenodo versions are bound to this release tag` };
  const rec = bound[0];
  const doiOk = typeof rec.doi === 'string' && /^10\.5281\/zenodo\.\d+$/u.test(rec.doi) && rec.doi !== CONCEPT_DOI;
  const c = {
    version_doi: doiOk && (entry.versionDoi === undefined || entry.versionDoi === rec.doi) ? 'match' : 'mismatch',
    record_id: doiOk && String(rec.id) === rec.doi.slice('10.5281/zenodo.'.length) ? 'match' : 'mismatch',
    concept_doi: rec.conceptdoi === CONCEPT_DOI ? 'match' : 'mismatch',
    tag_binding: 'match',
    record_version: rec.metadata.version === entry.version ? 'match' : 'mismatch',
    creator_orcid: (rec.metadata.creators ?? []).some(x => x && typeof x === 'object' && x.orcid === RESEARCHER_ORCID) ? 'match' : 'mismatch',
    license: (rec.metadata.license && typeof rec.metadata.license === 'object' && rec.metadata.license.id === ZENODO_LICENSE) ? 'match' : 'mismatch'
  };
  const failed = Object.entries(c).filter(([, v]) => v !== 'match').map(([k]) => k);
  return { state: failed.length ? 'mismatch' : 'pass', version_doi: doiOk ? rec.doi : null, comparisons: c, detail: failed.length ? `registration disagrees on: ${failed.join(', ')}` : null };
}

export async function buildAneRecord(rel) {
  validateReleaseShell(rel, ANE_TAG_RX);
  const tag = rel.tag_name;
  const entry = aneIndexEntry(await loadRepoFileAtTag('records/index.json', tag), tag);
  const guards = [
    { name: 'published release tag ane-record- plus 24 hex; release shell valid', state: 'pass', detail: null },
    { name: 'records index at the tag lists this record once (schema, all-versions DOI, v0.1.0 baseline)', state: 'pass', detail: null }
  ];

  const relAssets = await verifyAneAssets(rel);
  guards.push({
    name: 'exactly four release assets re-downloaded; bytes equal their registered digests',
    state: relAssets.verified ? 'pass' : 'degraded',
    detail: relAssets.verified ? null : relAssets.reasons.join('; ')
  });

  const rp = await checkAneReviewPackage(tag, entry, relAssets.assets);
  guards.push({
    name: 'review package at the tag is canonical, hashes to the index entry and lists the asset digests',
    state: rp.ok ? 'pass' : 'degraded',
    detail: rp.detail
  });

  const verdict = await checkAneVerdict(tag, entry);
  guards.push({
    name: `final verdict at the tag is INCLUDE from ${ANE_FINAL_REVIEWER} for that review package hash`,
    state: verdict.ok ? 'pass' : 'degraded',
    detail: verdict.detail
  });

  const z = await crosscheckAneZenodo(tag, entry);
  guards.push({
    name: 'Zenodo version under the all-versions DOI bound to this tag (DOI, ORCID, license, version)',
    state: z.state === 'pass' ? 'pass' : 'degraded',
    detail: z.state === 'pass' ? null : z.detail
  });

  const state = guards.every(g => g.state === 'pass') ? 'verified' : 'degraded';
  const r = entry.replication;
  return {
    kind: ANE_KIND,
    tag,
    version: entry.version,
    title: entry.title,
    release_name: rel.name,
    published_at: rel.published_at,
    release_url: rel.html_url,
    released_on: entry.releasedOn,
    record_url: entry.siteUrl,
    record_repository: `https://github.com/${RELEASES_REPO}`,
    publication_id: entry.publicationId,
    package_hash: entry.packageHash,
    replication: {
      scope: r.scope,
      claim: r.claim,
      cross_device_replication: r.scope === 'cross-device',
      profile_hash: r.profileHash,
      run_count: r.runCount,
      pass_count: r.passCount,
      fail_count: r.failCount
    },
    review: {
      review_package_hash: entry.reviewPackageHash,
      verdict_digest: entry.verdictDigest,
      reviewer: ANE_FINAL_REVIEWER,
      decision: verdict.decision
    },
    doi: {
      version_doi: z.version_doi,
      concept_doi: CONCEPT_DOI,
      zenodo_record_url: z.version_doi ? `https://zenodo.org/records/${doiId(z.version_doi, 'zenodo version doi')}` : null,
      binding_source: 'Zenodo version search under the all-versions DOI (tree URL of the tag)',
      registered_state: { pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now', not_minted: 'not_minted' }[z.state],
      crosscheck: { state: z.state, comparisons: z.comparisons, detail: z.detail }
    },
    assets: relAssets.assets,
    verification: { state, guards }
  };
}

function aneCoreKey(rec) {
  return JSON.stringify({
    kind: rec.kind,
    tag: rec.tag,
    version: rec.version,
    title: rec.title,
    release_name: rec.release_name,
    published_at: rec.published_at,
    release_url: rec.release_url,
    released_on: rec.released_on,
    record_url: rec.record_url,
    record_repository: rec.record_repository,
    publication_id: rec.publication_id,
    package_hash: rec.package_hash,
    replication: rec.replication,
    review: rec.review,
    doi: { version_doi: rec.doi.version_doi, concept_doi: rec.doi.concept_doi, zenodo_record_url: rec.doi.zenodo_record_url },
    assets: rec.assets.map(a => ({ name: a.name, url: a.url, size: a.size, digest: a.digest }))
  });
}

// -- rendering ---------------------------------------------------------------

function renderRecord(rec) {
  const ok = rec.verification.state === 'verified';
  const pill = `<span class="pub-status ${ok ? 'pub-status-verified' : 'pub-status-degraded'}">${ok ? 'Re-verified at rebuild' : 'Degraded — treat unverified'}</span>`;
  const pages = rec.provenance.source_pages.map(p => {
    const mark = { match: 'fingerprint match at pinned commit', mismatch: 'FINGERPRINT MISMATCH', unreachable: 'unreachable at rebuild' }[p.fingerprint_check];
    return `<li>${attrsLink(p.url, p.path.replace(/index\.html$/, ''))} · <code>${esc(p.sha256)}</code> · <span class="pub-fp-${esc(p.fingerprint_check)}">${esc(mark)}</span></li>`;
  }).join('');
  const doiLines = [
    rec.doi.version_doi
      ? `<li>${attrsLink(`https://doi.org/${rec.doi.version_doi}`, `Version DOI ${rec.doi.version_doi}`)}</li>${rec.doi.concept_doi ? `<li>${attrsLink(`https://doi.org/${rec.doi.concept_doi}`, `All-versions DOI ${rec.doi.concept_doi}`)}</li>` : ''}<li><span class="pub-fp-${rec.doi.registered_state === 'registered_verified' ? 'match' : 'unreachable'}">registration state: ${esc(rec.doi.registered_state)} — derived from the live Zenodo record at rebuild, not from release text</span></li>`
      : `<li><span class="pub-fp-unreachable">no DOI was verifiable at rebuild (released DOI state recorded in the tagged manifest: ${esc(rec.doi.tagged_manifest_doi_status)})</span></li>`
  ].join('');
  const zenodoLine = rec.doi.zenodo_record_url
    ? `${attrsLink(rec.doi.zenodo_record_url, `Archived as a registered dataset: DOI ${rec.doi.version_doi}`)}. An archived DOI is not peer review; the registration state shown above was re-derived from Zenodo at rebuild.`
    : 'No DOI claim is attached to this rebuild — see the verification guards.';
  const assets = rec.assets.map(a =>
    `<li><code>${esc(a.name)}</code> <span class="num">(${a.size.toLocaleString('en-US')} bytes)</span><br><span class="pub-digest">SHA-256 <code>${esc(a.sha256 ?? 'byte verification pending')}</code></span> · ${attrsLink(a.url, 'download at release')}</li>`
  ).join('');
  const limits = rec.evidence_limits.map(l => `<li>${esc(l)}</li>`).join('');
  return `
<article class="pub-record" data-tag="${esc(rec.tag)}">
<h3>${esc(rec.release_name)}</h3>
<p class="pub-statusline">${pill}</p>
<p><time datetime="${esc(rec.published_at)}">${esc(humanDate(rec.published_at))}</time> · tag <code>${esc(rec.tag)}</code> · ${esc(rec.record_class)}</p>
<p>${attrsLink(rec.release_url, 'View this release in the archive repository')}. ${zenodoLine}</p>
<div class="pub-dl">
<div><span class="label">Registered identifiers</span><ul>
${doiLines}
</ul></div>
<div><span class="label">Original research provenance</span><ul>
<li>Pinned source commit <code>${esc(rec.provenance.site_commit)}</code> in <code>${esc(SITE_REPO_NAME)}</code></li>
${pages}
</ul></div>
<div><span class="label">Archive assets and integrity</span><ul>
${assets}
<li><span class="pub-fp-${rec.sha256_sums.verified ? 'match' : 'unreachable'}">${rec.sha256_sums.verified ? 'checksum file re-verified at rebuild: SHA256SUMS bytes match the registered release digest and its entries match the re-hashed assets' : 'checksum file verification incomplete — treat digests as unconfirmed'}</span></li>
</ul></div>
<div><span class="label">Verification guards</span><ul>
${rec.verification.guards.map(g => `<li><span class="pub-fp-${g.state === 'pass' ? 'match' : 'unreachable'}">${g.state === 'pass' ? '✓' : '✗'}</span> ${esc(g.name)}${g.detail ? ` — ${esc(g.detail)}` : ''}</li>`).join('')}
</ul></div>
</div>
<div class="callout"><span class="label">Evidence limits</span><p>${esc(rec.evidence_limits[0])}</p></div>
<details class="pub-details"><summary>All ${rec.evidence_limits.length} registered evidence limits</summary><ul class="pub-limits">${limits}</ul></details>
</article>`;
}

// A same-chip rerun is repeatability on one chip; it never reads as replication.
function aneScopeLabel(r) {
  return r.cross_device_replication
    ? 'Cross-device replication'
    : 'Same-chip rerun: repeatability only, not cross-device replication';
}

function renderGuards(rec) {
  return rec.verification.guards.map(g => `<li><span class="pub-fp-${g.state === 'pass' ? 'match' : 'unreachable'}">${g.state === 'pass' ? '✓' : '✗'}</span> ${esc(g.name)}${g.detail ? ` — ${esc(g.detail)}` : ''}</li>`).join('');
}

export function renderAneRecord(rec) {
  const ok = rec.verification.state === 'verified';
  const pill = `<span class="pub-status ${ok ? 'pub-status-verified' : 'pub-status-degraded'}">${ok ? 'Re-verified at rebuild' : 'Degraded — treat unverified'}</span>`;
  const r = rec.replication;
  const doiShown = ok && rec.doi.registered_state === 'registered_verified' && rec.doi.version_doi;
  const doiLines = doiShown
    ? `<li>${attrsLink(`https://doi.org/${rec.doi.version_doi}`, `Version DOI ${rec.doi.version_doi}`)}</li><li>${attrsLink(`https://doi.org/${rec.doi.concept_doi}`, `All-versions DOI ${rec.doi.concept_doi}`)}</li><li><span class="pub-fp-match">registration state: registered_verified — the Zenodo version bound to this tag was found under the all-versions DOI at rebuild, not taken from release text</span></li>`
    : `<li><span class="pub-fp-unreachable">no version DOI shown: registration state ${esc(rec.doi.registered_state)}${rec.doi.crosscheck.detail ? ` — ${esc(rec.doi.crosscheck.detail)}` : ''}</span></li>`;
  const assets = rec.assets.map(a =>
    `<li><code>${esc(a.name)}</code> <span class="num">(${a.size.toLocaleString('en-US')} bytes)</span><br><span class="pub-digest">SHA-256 <code>${esc(a.sha256 ?? 'byte verification pending')}</code></span> · ${attrsLink(a.url, 'download at release')}</li>`
  ).join('');
  return `
<article class="pub-record" data-tag="${esc(rec.tag)}" data-kind="${esc(rec.kind)}">
<h3>${esc(rec.version)} · ${esc(rec.title)}</h3>
<p class="pub-statusline">${pill}</p>
<p><time datetime="${esc(rec.published_at)}">${esc(humanDate(rec.published_at))}</time> · tag <code>${esc(rec.tag)}</code> · reviewed research record</p>
<p>${attrsLink(rec.record_url, 'Read the record page')}. ${attrsLink(rec.release_url, 'View this release in the archive repository')}. A reviewed record and an archived DOI are not peer review.</p>
<div class="pub-dl">
<div><span class="label">Replication</span><ul>
<li><strong>${esc(aneScopeLabel(r))}</strong></li>
<li>Claim as recorded: <q>${esc(r.claim)}</q></li>
<li>Setup profile <code>${esc(r.profile_hash)}</code></li>
<li>${r.run_count} runs kept: ${r.pass_count} pass, ${r.fail_count} fail</li>
</ul></div>
<div><span class="label">Final review</span><ul>
<li>Review package <code>${esc(rec.review.review_package_hash)}</code></li>
<li>${esc(rec.review.decision)} verdict from <code>${esc(rec.review.reviewer)}</code>, digest <code>${esc(rec.review.verdict_digest)}</code></li>
</ul></div>
<div><span class="label">Registered identifiers</span><ul>
${doiLines}
</ul></div>
<div><span class="label">Release assets and integrity</span><ul>
${assets}
</ul></div>
<div><span class="label">Verification guards</span><ul>
${renderGuards(rec)}
</ul></div>
</div>
</article>`;
}

function renderAneIndexItem(rec) {
  const ok = rec.verification.state === 'verified';
  const r = rec.replication;
  let href = '/publications/';
  try { checkHost(rec.record_url, ['macbrainslabs.org'], 'record page'); href = rec.record_url; } catch { /* keep the feed link */ }
  const short = h => `${esc(String(h).slice(0, 12))}…`;
  const doi = ok && rec.doi.registered_state === 'registered_verified' && rec.doi.version_doi ? ` · DOI ${esc(rec.doi.version_doi)}` : '';
  const assets = rec.assets.map(a => `${esc(a.name)} <code>${a.sha256 ? short(a.sha256) : 'unverified'}</code>`).join(' · ');
  return `<li><a href="${esc(href)}"><span class="id">${esc(rec.version)}</span><div><h3>${esc(rec.title)}</h3><p>${esc(aneScopeLabel(r))}. Claim: ${esc(r.claim)}</p><p>Setup profile <code>${short(r.profile_hash)}</code> · ${r.run_count} runs kept (${r.pass_count} pass, ${r.fail_count} fail) · review package <code>${short(rec.review.review_package_hash)}</code> · ${esc(rec.review.decision)} verdict <code>${short(rec.review.verdict_digest)}</code>${doi}</p><p>SHA-256: ${assets}</p></div><span class="tags">${ok ? 'Research record · DOI registered' : 'Research record · degraded verification'}</span></a></li>`;
}

export function renderFeedPage(data) {
  const records = data.records.map(rec => rec.kind === ANE_KIND ? renderAneRecord(rec) : renderRecord(rec)).join('\n');
  const hasAne = data.records.some(rec => rec.kind === ANE_KIND);
  const generated = data.generated_at;
  const newest = data.records[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111315" media="(prefers-color-scheme: dark)">
<title>Publications and verified release archive · MacBrains Labs</title>
<meta name="description" content="Published archive releases of MacBrains Labs research records, each re-checked at rebuild time: SHA-256 provenance at the pinned commit and DOI registration from Zenodo.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MacBrains Labs">
<meta property="og:title" content="Publications and verified release archive">
<meta property="og:description" content="Published archive releases of MacBrains Labs research records, each re-checked at rebuild time: SHA-256 provenance at the pinned commit and DOI registration from Zenodo.">
<meta property="og:url" content="https://macbrainslabs.org/publications/">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://macbrainslabs.org/publications/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "MacBrains Labs",
      "item": "https://macbrainslabs.org/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Publications",
      "item": "https://macbrainslabs.org/publications/"
    }
  ]
}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
<div class="wrap">
<a class="wordmark" href="/"><span class="wordmark-name">MacBrains Labs</span><span class="wordmark-desc">Apple Silicon research</span></a>
<nav class="nav" aria-label="Main navigation">
<a href="/research/">Research</a>
<a href="/methods/">Methods</a>
<a href="/notes/">Notes</a>
<a href="/publications/" aria-current="page">Publications</a>
<a href="/security/">Security</a>
<a href="/contact/">Contact</a>
</nav>
</div>
</header>
<main id="main">
<header class="page-head">
<div class="wrap">
<p class="crumbs"><a href="/">MacBrains Labs</a> / Publications</p>
<h1>Publications.</h1>
<p class="lede">The archive release feed for the public research record. Every entry is a published GitHub release tag whose provenance chain was re-derived from upstream at rebuild time — not a new result, not a promotion, not a claim of peer review.</p>
<dl class="facts">
<div><dt>Record repository</dt><dd>${attrsLink(`https://github.com/${RELEASES_REPO}`, RELEASES_REPO)}</dd></div>
<div><dt>Last rebuilt</dt><dd><time datetime="${esc(generated)}">${esc(humanDate(generated))}</time></dd></div>
<div><dt>Rebuild sources</dt><dd>release API · manifest at tag · pinned-commit bytes · Zenodo registration</dd></div>
<div><dt>Cite all versions</dt><dd>${newest.doi.concept_doi ? attrsLink(`https://doi.org/${newest.doi.concept_doi}`, `DOI ${newest.doi.concept_doi}`) : `no DOI verifiable at rebuild (registration state: ${esc(newest.doi.registered_state)})`}</dd></div>
</dl>
</div>
</header>

<section class="section wrap" style="padding-block:2.25rem 1.5rem;border-top:0" aria-labelledby="qualify-h">
<div class="section-head">
<span class="label">How a record qualifies</span>
<div>
<h2 id="qualify-h">${hasAne ? 'Seven' : 'Six'} checks stand between upstream and this page.</h2>
<p>This feed does not transcribe release text. It renders only structured fields that survived validation, and anything that could not be re-checked is surfaced as a degraded state, never silently smoothed. Draft and prerelease releases cannot enter.</p>
</div>
</div>
<ol class="principles">
<li><span class="n">01</span><div><h3>Published tag only</h3><p>Records enter as published GitHub release tags <code>vX.Y.Z</code>${hasAne ? ' or <code>ane-record-</code> plus 24 hex digits' : ''} of the archive repository. Draft and prerelease releases are structurally excluded.</p></div></li>
<li><span class="n">02</span><div><h3>Manifest at the tag</h3><p>Each release must carry <code>manifest.json</code> (schema 1.0) with source document fingerprints, explicit evidence limits and a DOI binding. A missing field stops the whole rebuild before anything is published.</p></div></li>
<li><span class="n">03</span><div><h3>Bytes re-checked</h3><p>Release assets are downloaded at rebuild and hashed. Digests must equal those the release API registers, and <code>SHA256SUMS</code> must be internally consistent and agree.</p></div></li>
<li><span class="n">04</span><div><h3>Provenance re-derived</h3><p>Every listed source document is fetched from the pinned site commit and its SHA-256 must equal the manifest fingerprint. A mismatch marks the record degraded, it is never deleted quietly.</p></div></li>
<li><span class="n">05</span><div><h3>Registration cross-checked</h3><p>The manifest DOIs must point at a Zenodo record whose version DOI, concept DOI, title, publication date, creator ORCID and license match the manifest. Disagreement is shown, never averaged away.</p></div></li>
<li><span class="n">06</span><div><h3>Last-known-good</h3><p>This feed publishes only independently verified records. If upstream is unreachable, rate-limited, if a previously verified record re-derives degraded (even over changed upstream data), if a new record is not fully verified, or if a record is removed, the whole update is held: this page keeps its previous snapshot and the failure stays visible in the repository's public workflow history.</p></div></li>${hasAne ? `
<li><span class="n">07</span><div><h3>Reviewed research records</h3><p>An <code>ane-record-</code> release must carry exactly four assets whose re-downloaded bytes equal their registered digests. At the tag, its canonical review package must hash to its records index entry and list those digests, and the final reviewer's verdict for that hash must be INCLUDE. Zenodo must hold one version under the all-versions DOI bound to the tag, with matching ORCID, license and version; a version not minted yet holds the update. Same-chip reruns are labelled as repeatability, never as cross-device replication.</p></div></li>` : ''}
</ol>
</section>

<section class="section" id="records" aria-labelledby="records-h" data-generated="${esc(generated)}" data-state="${esc(data.upstream_status)}">
<div class="wrap">
<div class="section-head">
<span class="label">Current records</span>
<div><h2 id="records-h">Published archive releases.</h2>
<p>Newest first. The pill reflects the latest successful rebuild; expand each record's guards to see exactly what was and was not re-checked. Feeds are regenerated only from validated upstream data and are refreshed from a scheduled workflow whenever the records change.</p></div>
</div>
${records}
</div>
</section>

<section class="section" aria-labelledby="limits-h">
<div class="wrap">
<div class="section-head">
<span class="label">Scope and limits</span>
<div><h2 id="limits-h">What this feed can and cannot claim.</h2>
<p>An archived DOI is registration, not peer review. These records republish already-public summaries; the feed itself makes no experimental claims and contains no drafts or locally-unverified data.</p></div>
</div>
<p>Numeric results referenced by the records live on this site's own pages with their source receipts — see ${attrsLink(`${BASE}/research/`, 'the research record')} and ${attrsLink(`${BASE}/notes/`, 'the field notes')}. The archiving repository ${attrsLink(`https://github.com/${RELEASES_REPO}`, 'macbrainslabs/ane-research-records')} carries its own integrity documentation. Correspondence is welcome at ${mailLink()}.</p>
</div>
</section>
</main>
<footer class="site-footer">
<div class="wrap">
<div class="footer-grid">
<div>
<span class="label">MacBrains Labs</span>
<p>Independent research on Apple Neural Engine execution, Core ML graph construction and on-device inference. Not affiliated with Apple.</p>
</div>
<div>
<span class="label">Correspondence</span>
<a class="footer-mail" href="mailto:research@macbrainslabs.org">research@macbrainslabs.org</a>
<p>Model execution, numerical parity, hardware behavior, reproducible tests.</p>
</div>
<div>
<span class="label">Index</span>
<ul>
<li><a href="/research/">Research record</a></li>
<li><a href="/methods/">Methodology</a></li>
<li><a href="/notes/">Field notes</a></li>
<li><a href="/publications/">Publications</a></li>
<li><a href="/security/">Defensive research</a></li>
<li><a href="/contact/">Contact</a></li>
</ul>
</div>
</div>
<div class="footer-fine"><span>© 2026 MacBrains Labs · Independent research · No Apple affiliation</span><span>Static site. No scripts, cookies or analytics.</span></div>
</div>
</footer>
</body>
</html>`;
}

export function renderIndexBlock(data) {
  const items = data.records.map(rec => rec.kind === ANE_KIND ? renderAneIndexItem(rec) : `<li><a href="/publications/"><span class="id">${esc(rec.tag)}</span><div><h3>${esc(rec.zenodo_title)}</h3><p>${esc(rec.record_class)}</p></div><span class="tags">${rec.verification.state === 'verified' ? 'Archive record · DOI registered' : 'Archive record · degraded verification'}</span></a></li>`).join('\n');
  return `<ul class="notes">\n${items}\n</ul>`;
}

// -- write / last-known-good logic -------------------------------------------

function readPrevJson() {
  try { return JSON.parse(fs.readFileSync(feedJsonPath, 'utf8')); } catch { return null; }
}

function spliceHome(block) {
  const html = fs.readFileSync(homePath, 'utf8');
  const i = html.indexOf(markers.start);
  const j = html.indexOf(markers.end);
  assert.ok(i !== -1 && j !== -1 && j > i, 'index.html lacks the publications marker comments');
  return `${html.slice(0, i + markers.start.length)}\n${block}\n${html.slice(j)}`;
}

async function main() {
  const started = Date.now();
  output(`rebuild requested at ${isoNow()} (cache-buster: ${process.pid})`);

  const allReleases = await loadReleases().catch(e => {
    if (unreachable(e)) die(2, `release endpoint unreachable: ${e.message}`);
    die(1, `release endpoint failed structurally: ${e.message}`);
  });
  const published = allReleases.filter(r => !r.draft && !r.prerelease && (TAG_RX.test(r.tag_name) || ANE_TAG_RX.test(r.tag_name)));
  for (const rel of published) validateReleaseShell(rel, ANE_TAG_RX.test(rel.tag_name) ? ANE_TAG_RX : TAG_RX);
  const byTag = new Map();
  for (const rel of [...published].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))) {
    if (!byTag.has(rel.tag_name)) byTag.set(rel.tag_name, rel);
  }
  const chosen = [...byTag.values()].slice(0, MAX_RECORDS);
  assert.ok(chosen.length >= 1, 'the archive repository has no published vX.Y.Z release');
  output(`upstream published tags: ${[...byTag.keys()].join(', ')}`);

  const prev = readPrevJson();
  if (prev && Array.isArray(prev.records)) {
    const prevTags = new Set(prev.records.map(r => r.tag));
    const newTags = new Set(chosen.map(r => r.tag_name));
    const vanished = [...prevTags].filter(t => !newTags.has(t));
    assert.ok(vanished.length === 0, `records vanished upstream without human review: ${vanished.join(', ')} — refusing to publish removal`);
  }

  const records = [];
  for (const rel of chosen) records.push(await (ANE_TAG_RX.test(rel.tag_name) ? buildAneRecord(rel) : buildRecord(rel)));
  records.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

  const data = {
    schema: 'macbrainslabs.publications.v1',
    generated_at: isoNow(),
    source: {
      release_repository: RELEASES_REPO,
      release_repository_url: `https://github.com/${RELEASES_REPO}`,
      site_repository: SITE_REPO_URL,
      publisher: PUBLISHER_IDENTITY,
      researcher_orcid: RESEARCHER_ORCID
    },
    policy: {
      qualifies: qualifiesPolicy(records),
      recheck: 'claims are re-derived at rebuild: asset bytes hashed against registered digests and SHA256SUMS; manifest fingerprints compared with pinned-commit bytes; DOI registration cross-checked via the Zenodo API; release prose is never rendered',
      last_known_good: 'the whole update is held (previous snapshot stays deployed) unless EVERY rebuilt record is independently verified: any previously verified record re-deriving degraded holds even when its upstream data changed, and any new record that is not fully verified holds; failed, unreachable and removed-record rebuilds never publish',
      refresh: 'scheduled GitHub Actions workflow on the site repository; also runnable manually via workflow_dispatch'
    },
    records
  };
  data.upstream_status = records.every(r => r.verification.state === 'verified') ? 'ok' : 'partial';

  // Last-known-good decision: fail closed on any verified -> degraded
  // transition over unchanged data, hold updates carrying unverified new
  // records, and never publish a verbatim copy of the previous snapshot.
  const outcome = lastKnownGoodDecision(prev?.records ?? [], records);
  if (outcome.decision === 'hold') die(2, `last-known-good hold: ${outcome.reasons.join('; ')}`);
  data.generated_at = outcome.decision === 'no_change' ? (prev?.generated_at ?? data.generated_at) : data.generated_at;

  const json = `${JSON.stringify(data, null, 2)}\n`;
  const html = renderFeedPage(data);
  const block = renderIndexBlock(data);
  const home = spliceHome(block);

  let wrote = 0;
  const writeIfChanged = (p, content) => {
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    wrote++;
    output(`wrote ${path.relative(root, p)} (${content.length} bytes)`);
  };
  writeIfChanged(feedJsonPath, json);
  writeIfChanged(feedHtmlPath, html);
  writeIfChanged(homePath, home);
  if (outcome.decision === 'no_change' && wrote === 0) {
    output(`unchanged: upstream data and verification identical, rendered output matches (records from ${data.generated_at})`);
    return;
  }
  output(`done: ${records.length} record(s), upstream_status=${data.upstream_status}, decision=${outcome.decision}, wrote=${wrote}, ${Date.now() - started} ms`);
}

// The data core of a record: everything derived from the archive repository at
// rebuild time, minus every field that is itself a re-derivation result
// (cross-check state, guard states, verified asset digests, fingerprint
// outcomes, checksum status). Two cores differ only when the upstream record,
// its tag-time manifest or its registered DOI candidate actually changed.
// Cores are used for churn detection (no_change); under the verified-only
// publication bar a core change can never excuse a degraded record.
export function coreKey(rec) {
  if (rec.kind === ANE_KIND) return aneCoreKey(rec);
  return JSON.stringify({
    tag: rec.tag,
    release_name: rec.release_name,
    published_at: rec.published_at,
    release_url: rec.release_url,
    record_class: rec.record_class,
    zenodo_title: rec.zenodo_title,
    record_repository: rec.record_repository,
    provenance: {
      site_repository: rec.provenance.site_repository,
      site_commit: rec.provenance.site_commit,
      source_pages: rec.provenance.source_pages.map(p => ({ path: p.path, url: p.url, sha256: p.sha256 }))
    },
    doi: {
      version_doi: rec.doi.version_doi,
      concept_doi: rec.doi.concept_doi,
      zenodo_record_url: rec.doi.zenodo_record_url,
      tagged_manifest_doi_status: rec.doi.tagged_manifest_doi_status,
      binding_source: rec.doi.binding_source
    },
    assets: rec.assets.map(a => ({ name: a.name, url: a.url, size: a.size, digest: a.digest })),
    evidence_limits: rec.evidence_limits
  });
}

// Multi-record last-known-good rule. The public feed carries ONLY
// independently verified records, so any rebuilt record that is not fully
// verified — previously verified or brand new, with unchanged or changed
// upstream data — holds the WHOLE update. Partially published feeds would
// drop records the previous snapshot showed or admit unverified findings,
// and exactly one public bar exists.
export function lastKnownGoodDecision(prevRecords, newRecords) {
  const reasons = [];
  const prev = Array.isArray(prevRecords) ? prevRecords : [];
  assert.ok(Array.isArray(newRecords) && newRecords.length >= 1, 'no rebuilt records');
  const prevIds = new Set(prev.map(r => r.tag));
  for (const n of newRecords) {
    if (n.verification.state === 'verified') continue;
    reasons.push(prevIds.has(n.tag)
      ? `${n.tag}: previously verified record re-derived degraded; a changed upstream core does not lower the verification bar (fail closed)`
      : `${n.tag}: new record is not fully verified; holding the update instead of auto-publishing an unverified entry`);
  }
  for (const p of prev) {
    if (!newById(newRecords).has(p.tag)) reasons.push(`${p.tag}: record vanished upstream; removal requires human review`);
  }
  if (reasons.length) return { decision: 'hold', reasons };
  const identical = prev.length > 0 && prev.length === newRecords.length &&
    newRecords.every((rec, i) => prev[i].tag === rec.tag && rec.verification.state === 'verified' && prev[i]?.verification?.state === 'verified' && coreKey(rec) === coreKey(prev[i]));
  if (identical) return { decision: 'no_change', reasons: [] };
  return { decision: 'publish', reasons: [] };
}

function newById(newRecords) {
  return new Map(newRecords.map(r => [r.tag, r]));
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch(e => die(1, e && e.stack ? e.stack : String(e)));
}
