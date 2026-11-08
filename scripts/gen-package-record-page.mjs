// Generates research/records/<tag>/index.html for a package record from the
// record files themselves (attestation.json, preview.md, package/FILES.sha256,
// the reviewed record and each arm's execution log).
// Usage: node gen-package-record-page.mjs <records-repo> <site-repo> <tag> [versionDoi]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {socialPathForRoute} from './social-path.mjs';

const [recordsRepo, siteRepo, tag, versionDoi] = process.argv.slice(2);
if (!recordsRepo || !siteRepo || !/^ane-record-[0-9a-f]{24}$/.test(tag ?? '')) throw new Error('usage: node gen-package-record-page.mjs <records-repo> <site-repo> <tag> [versionDoi]');
if (versionDoi !== undefined && !/^10\.5281\/zenodo\.\d+$/.test(versionDoi)) throw new Error('versionDoi must be 10.5281/zenodo.N');
const dir = path.join(recordsRepo, 'records', tag);
const rd = n => fs.readFileSync(path.join(dir, n));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const index = JSON.parse(fs.readFileSync(path.join(recordsRepo, 'records/index.json'), 'utf8'));
const entry = index.records.find(r => r.tag === tag);
if (!entry || entry.kind !== 'package') throw new Error('no package index entry for ' + tag);
const attRaw = rd('attestation.json');
if (sha(attRaw) !== entry.attestationSha256) throw new Error('attestation hash differs from the index');
const a = JSON.parse(attRaw.toString('utf8'));
if (a.schema !== 'macbrains.dataset.package-attestation.v1' || a.tag !== tag) throw new Error('attestation schema or tag differs');
if (a.finalReview.decision !== 'INCLUDE' || a.finalReview.reviewedPackageSha256 !== a.reviewedPackage.sha256) throw new Error('no INCLUDE for the reviewed package');
const filesRaw = rd('package/FILES.sha256');
if (sha(filesRaw) !== a.package.filesListSha256) throw new Error('FILES.sha256 differs from the attestation');
const recordRaw = rd('package/' + a.package.recordFile);
if (sha(recordRaw) !== a.package.recordSha256 || sha(recordRaw) !== entry.recordSha256) throw new Error('record hash differs');
const previewRaw = rd('preview.md');
const pv = a.releaseAssets.find(x => x.name === 'preview.md');
if (!pv || sha(previewRaw) !== pv.sha256) throw new Error('preview hash differs');
const r = a.replication;
const passed = x => x.exitCode === 0 && x.byteIdentical === true && (x.passed === undefined || x.passed === true);
const armRows = [];
const logFiles = [];
for (const arm of r.arms) {
  const raw = fs.readFileSync(path.join(dir, arm.executionLog));
  if (sha(raw) !== arm.executionLogSha256) throw new Error('execution log hash differs: ' + arm.arm);
  const lines = raw.toString('utf8').trim().split('\n').map(l => JSON.parse(l));
  const done = lines.filter(x => x.kind === 'run_completed');
  if (lines.filter(x => x.kind === 'run_started').length !== arm.started || done.length !== arm.completed || done.filter(passed).length !== arm.passed) throw new Error('recount differs: ' + arm.arm);
  armRows.push(arm);
  logFiles.push({ name: arm.executionLog, sha256: arm.executionLogSha256, bytes: raw.length });
}
const counted = armRows.reduce((n, x) => n + x.completed, 0);
const pass = armRows.reduce((n, x) => n + x.passed, 0);
if (counted !== r.runsTotal || pass !== r.runsPass || counted !== entry.replication.counted) throw new Error('run totals differ');
if (r.crossDeviceReplication !== false || r.scope !== 'same-chip') throw new Error('only same-chip package records are rendered');

const BASE = 'https://macbrainslabs.org';
const ROUTE = `/research/records/${tag}/`;
const URL_ = BASE + ROUTE;
const socialURL = BASE + socialPathForRoute(ROUTE);
if (URL_ !== a.siteUrl) throw new Error('siteUrl differs');
const REPO = 'https://github.com/macbrainslabs/ane-research-records';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const code = s => `<code>${esc(s)}</code>`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${months[m - 1]} ${y}`; };
const released = entry.releasedOn;
const scopeLabel = 'Same-chip rerun: repeatability only, not cross-device replication';
const title = 'ANERECore cross-repo MIL parity record';
const description = `Package research record ${a.version}: ANERECore MIL text parity for tap, steer and functionWide on one Mac. Same chip only; ANE execution not claimed; no novelty claim.`;
if (description.length > 200) throw new Error('description too long');
const runRows = armRows.map(x => `<tr><td>${esc(x.arm)}</td><td>${code(x.profileHash)}<br>committed at ${code(x.profileCommit.slice(0, 8))}</td><td>${esc(x.tool)}<br>${code(x.toolCommit.slice(0, 8))}</td><td class="numeric">${x.started}</td><td class="numeric">${x.completed}</td><td class="numeric">${x.passed}</td></tr>`).join('\n');
const fileRows = [
  { name: 'attestation.json', sha256: entry.attestationSha256, bytes: attRaw.length },
  { name: 'preview.md', sha256: pv.sha256, bytes: previewRaw.length },
  { name: 'package/FILES.sha256', sha256: a.package.filesListSha256, bytes: filesRaw.length },
  { name: 'package/' + a.package.recordFile, sha256: a.package.recordSha256, bytes: recordRaw.length },
  ...logFiles
].map(f => `<tr><td><a href="${REPO}/blob/${tag}/records/${tag}/${esc(f.name)}">${esc(f.name)}</a></td><td class="numeric">${f.bytes.toLocaleString('en-US')}</td><td>${code(f.sha256)}</td></tr>`).join('\n');
const tar = a.package.tar;
const disclosures = a.disclosures.map(l => `<li>${esc(l)}</li>`).join('\n');
const notes = a.notes.map(n => `<li>${esc(n.text)}</li>`).join('\n');
const doiFact = versionDoi
  ? `<a href="https://doi.org/${versionDoi}">DOI ${versionDoi}</a>`
  : `version DOI pending registration · <a href="https://doi.org/${a.conceptDoi}">all versions: DOI ${a.conceptDoi}</a>`;
const doiPara = versionDoi
  ? `Cite this version as <a href="https://doi.org/${versionDoi}">DOI ${versionDoi}</a>; all versions of the record series share <a href="https://doi.org/${a.conceptDoi}">DOI ${a.conceptDoi}</a>.`
  : `Zenodo registers a version DOI for this release under the all-versions <a href="https://doi.org/${a.conceptDoi}">DOI ${a.conceptDoi}</a>; it is added here once the registration is verified.`;
const ld = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'MacBrains Labs', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Research record', item: `${BASE}/research/` },
      { '@type': 'ListItem', position: 3, name: `Record ${a.version}`, item: URL_ }
    ] },
    { '@type': 'Dataset', '@id': `${URL_}#dataset`, name: a.title, description, url: URL_, version: a.version,
      ...(versionDoi ? { identifier: `https://doi.org/${versionDoi}`, sameAs: `https://zenodo.org/records/${versionDoi.split('.').at(-1)}` } : {}),
      isPartOf: { '@type': 'Dataset', name: index.series, identifier: `https://doi.org/${a.conceptDoi}` },
      creator: { '@type': 'Person', name: 'Nayte Wilson', identifier: 'https://orcid.org/0009-0003-4026-8212' },
      license: 'https://creativecommons.org/licenses/by/4.0/', datePublished: released, inLanguage: 'en',
      keywords: ['Apple Neural Engine', 'Core ML', 'MIL', 'ANERECore'] }
  ]
};
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f3ed" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111315" media="(prefers-color-scheme: dark)">
<title>${esc(title)} · MacBrains Labs</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MacBrains Labs">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${URL_}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${socialURL}">
<meta property="og:image:secure_url" content="${socialURL}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="MacBrains Labs research: ${esc(title)}">
<meta name="twitter:image" content="${socialURL}">
<meta name="twitter:image:alt" content="MacBrains Labs research: ${esc(title)}">
<link rel="canonical" href="${URL_}">
<link rel="icon" href="/assets/brand-mark-96.png" type="image/png" sizes="96x96">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<meta name="apple-mobile-web-app-title" content="MacBrains Labs">
<link rel="icon" href="/assets/icon-16.png" type="image/png" sizes="16x16">
<link rel="icon" href="/assets/icon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/assets/icon-48.png" type="image/png" sizes="48x48">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
<div class="wrap">
<a class="wordmark" href="/" aria-label="MacBrains Labs home"><img class="wordmark-icon" src="/assets/brand-mark-96.png" width="42" height="42" alt=""><span class="wordmark-stack"><span class="wordmark-name">MacBrains <span>Labs</span></span><span class="wordmark-desc">Independent Apple Silicon research</span></span></a>
<nav class="nav" aria-label="Main navigation">
<a href="/research/" aria-current="page">Research</a>
<a href="/methods/">Methods</a>
<a href="/notes/">Notes</a>
<a href="/publications/">Publications</a>
<a href="/security/">Security</a>
<a href="/contact/">Contact</a>
</nav>
</div>
</header>
<main id="main">
<header class="page-head" data-tag="${tag}" data-record-kind="package">
<div class="wrap">
<p class="crumbs"><a href="/">MacBrains Labs</a> / <a href="/research/">Research record</a> / Record ${esc(a.version)}</p>
<h1>${esc(a.title)}</h1>
<p class="lede">A package research record: the reviewed package, republished byte for byte. ${esc(scopeLabel)}. MIL text byte equality only; ANE execution NOT CLAIMED; no novelty claim.</p>
<dl class="facts">
<div><dt>Version</dt><dd>${esc(a.version)} · released <time datetime="${released}">${human(released)}</time></dd></div>
<div><dt>Runs</dt><dd>${counted} counted runs, ${pass} pass, ${counted - pass} fail</dd></div>
<div><dt>Tier</dt><dd>Diagnostic · single device</dd></div>
<div><dt>Cite</dt><dd>${doiFact}</dd></div>
</dl>
</div>
</header>
<div class="wrap article-layout">
<nav class="toc" aria-label="On this page">
<span class="label">On this page</span>
<ol>
<li><a href="#scope">Scope</a></li>
<li><a href="#runs">Counted runs</a></li>
<li><a href="#notes">Notes at publication</a></li>
<li><a href="#disclosures">Disclosures</a></li>
<li><a href="#review">Review</a></li>
<li><a href="#files">Files</a></li>
</ol>
<div class="toc-out"><a href="/publications/">Publications</a><a href="/methods/">Methodology</a></div>
</nav>
<article class="article">
<h2 id="scope"><span class="sec">01</span>Scope</h2>
<div class="callout"><span class="label">Scope as reviewed</span><p><q>${esc(a.claimScope)}</q></p></div>
<p><strong>${esc(scopeLabel)}.</strong> Every counted run in this record ran on one Mac, the same chip. The record compares MIL text produced by two clean-room tool builds for the operations ${a.operations.map(esc).join(', ')}; it makes no claim about Core ML compilation, ANE execution or numerics. Novelty is ${esc(a.noveltyClaim)}. Probe tier at ${code(a.verification.commit.slice(0, 8))}: ${esc(a.verification.probeTier)}.</p>

<h2 id="runs"><span class="sec">02</span>Counted runs</h2>
<p>Each arm's setup profile was hashed and committed before its first counted run. The device-wide execution logs list ${counted} counted runs across ${armRows.length} clean-room arms: ${pass} pass, ${counted - pass} fail. A run passes when its completion line has exit code 0 and byte-identical output (and, where the log records one, a passing flag). Across the arms: ${esc(r.crossArmComparison)}. No run is omitted.</p>
<div class="table-scroll" tabindex="0"><table class="data-table">
<thead><tr><th scope="col">Arm</th><th scope="col">Setup profile</th><th scope="col">Tool</th><th scope="col" class="numeric">Started</th><th scope="col" class="numeric">Completed</th><th scope="col" class="numeric">Passed</th></tr></thead>
<tbody>
${runRows}
</tbody></table></div>
<p class="table-caption">Recounted from each arm's execution log, republished exactly as reviewed.</p>

<h2 id="notes"><span class="sec">03</span>Notes at publication</h2>
<p>These notes correct labels in the reviewed files without changing them; any change to those bytes would break the reviewed hash.</p>
<ul>
${notes}
</ul>

<h2 id="disclosures"><span class="sec">04</span>Disclosures, verbatim</h2>
<ul>
${disclosures}
</ul>

<h2 id="review"><span class="sec">05</span>Review and bindings</h2>
<ul>
<li>Reviewed package ${code(a.reviewedPackage.sha256)}: the hand-off manifest the final reviewer read. It is not republished; it binds the files below by hash.</li>
<li>Final review: ${esc(a.finalReview.decision)} from ${code(a.finalReview.reviewer)} for that package hash, round ${a.finalReview.round} of 2, verdict receipt ${code(a.finalReview.verdictReceiptSha256)}.</li>
<li>Reviewed record ${code(a.package.recordSha256)}; file list ${code(a.package.filesListSha256)} binds ${a.package.filesListed} files.</li>
<li>Attestation ${code(entry.attestationSha256)}.</li>
</ul>
<p>A reviewed record and an archived DOI are not peer review. ${doiPara}</p>

<h2 id="files"><span class="sec">06</span>Files</h2>
<div class="table-scroll" tabindex="0"><table class="data-table">
<thead><tr><th scope="col">File at the tag</th><th scope="col" class="numeric">Bytes</th><th scope="col">SHA-256</th></tr></thead>
<tbody>
${fileRows}
</tbody></table></div>
<p class="table-caption">${code('package/')} holds all ${a.package.fileCount} files byte for byte. The <a href="${REPO}/releases/tag/${tag}">GitHub release ${esc(tag)}</a> also carries the whole package as ${code(tar.name)} (${tar.bytes.toLocaleString('en-US')} bytes, ${code(tar.sha256)}) with <code>SHA256SUMS</code>; <code>scripts/verify.mjs</code> in the <a href="${REPO}">record repository</a> re-checks every hash and count.</p>
</article>
</div>
</main>
<footer class="site-footer">
<div class="wrap">
<div class="footer-grid">
<div>
<span class="footer-brand"><img src="/assets/brand-mark-96.png" width="30" height="30" alt=""><span>MacBrains Labs</span></span>
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
<li><a href="/notes/">Notes</a></li>
<li><a href="/publications/">Publications</a></li>
<li><a href="/security/">Defensive research</a></li>
<li><a href="/contact/">Contact</a></li>
</ul>
</div>
</div>
<div class="footer-fine"><span>© 2026 MacBrains Labs · Independent research · No Apple affiliation</span><span>Static site. No cookies, tracking or analytics.</span></div>
</div>
</footer>
</body>
</html>
`;
const out = path.join(siteRepo, 'research/records', tag, 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(JSON.stringify({ wrote: out, bytes: html.length, sha256: sha(Buffer.from(html)), versionDoi: versionDoi ?? null }));
