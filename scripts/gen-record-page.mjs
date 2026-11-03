// Generates research/records/<tag>/index.html for a diagnostic record from the
// record files themselves (attestation.json, bundle.json, execution-log.jsonl).
// Usage: node gen-page.mjs <records-repo> <site-repo> <tag> [versionDoi]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [recordsRepo, siteRepo, tag, versionDoi] = process.argv.slice(2);
if (!recordsRepo || !siteRepo || !/^ane-record-[0-9a-f]{24}$/.test(tag ?? '')) throw new Error('usage: node gen-page.mjs <records-repo> <site-repo> <tag> [versionDoi]');
if (versionDoi !== undefined && !/^10\.5281\/zenodo\.\d+$/.test(versionDoi)) throw new Error('versionDoi must be 10.5281/zenodo.N');
const dir = path.join(recordsRepo, 'records', tag);
const rd = n => fs.readFileSync(path.join(dir, n));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const index = JSON.parse(fs.readFileSync(path.join(recordsRepo, 'records/index.json'), 'utf8'));
const entry = index.records.find(r => r.tag === tag);
if (!entry || entry.kind !== 'diagnostic') throw new Error('no diagnostic index entry for ' + tag);
const attRaw = rd('attestation.json');
if (sha(attRaw) !== entry.attestationSha256) throw new Error('attestation hash differs from the index');
const a = JSON.parse(attRaw.toString('utf8'));
const bundleRaw = rd('bundle.json');
if (sha(bundleRaw) !== a.bundle.sha256) throw new Error('bundle hash differs from the attestation');
for (const f of a.files) if (sha(rd(f.name)) !== f.sha256) throw new Error('file hash differs: ' + f.name);
const log = rd('execution-log.jsonl').toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const ex = log.filter(x => x.kind !== 'log-header');
const r = a.replication;
if (ex.length !== r.logged) throw new Error('logged count differs');

const BASE = 'https://macbrainslabs.org';
const ROUTE = `/research/records/${tag}/`;
const URL_ = BASE + ROUTE;
if (URL_ !== a.siteUrl) throw new Error('siteUrl differs');
const REPO = 'https://github.com/macbrainslabs/ane-research-records';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const code = s => `<code>${esc(s)}</code>`;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${months[m - 1]} ${y}`; };
const released = entry.releasedOn;
const dev = a.device;
const deviceLine = `${dev.chip} (${dev.hwModel}), macOS ${dev.osVersion} (build ${dev.osBuild}), Core ML ${dev.coreMLBundleVersion}`;
const scopeLabel = r.crossDeviceReplication ? 'Cross-device replication' : 'Same-chip rerun: repeatability only, not cross-device replication';
const title = 'LFM3-1.7B layer-14 diagnostic record';
const description = `Diagnostic research record ${a.version}: LFM3-1.7B layer 14 under Core ML cpuAndNeuralEngine on one A18 Pro device. Same chip only; ANE execution inferred; no novelty claim.`;
if (description.length > 200) throw new Error('description too long');
const corrections = new Map((a.corrections ?? []).map(c => [c.runId, c]));
const outputCell = x => x.present === true ? 'kept' : x.present === 'deleted' ? 'deleted; recovered record disclosed' : esc(String(x.present));
const statusCell = x => x.status === 'pre-freeze' ? 'before freeze, not counted' : esc(x.status);
const startedCell = x => {
  const c = corrections.get(x.runId);
  return c && c.field === 'runStartedAt' ? `${code(x.runStartedAt)}<br>corrected to ${code(c.corrected)}` : code(x.runStartedAt);
};
const runRows = ex.map(x => `<tr><td>${code(x.runId)}</td><td>${x.toolCommit ? code(String(x.toolCommit).slice(0, 8)) : "none"}</td><td>${startedCell(x)}</td><td>${statusCell(x)}</td><td>${x.counted === true ? 'yes' : 'no'}</td><td>${outputCell(x)}</td></tr>`).join('\n');
const fileRows = [{ name: 'attestation.json', sha256: entry.attestationSha256, bytes: attRaw.length }, ...a.files]
  .map(f => `<tr><td><a href="${REPO}/blob/${tag}/records/${tag}/${esc(f.name)}">${esc(f.name)}</a></td><td class="numeric">${f.bytes.toLocaleString('en-US')}</td><td>${code(f.sha256)}</td></tr>`).join('\n');
const reviews = a.pipelineReviews.map(p => `<li>${esc(p.role.replace('_', ' '))}: ${code(p.model)}, ${esc(p.verdict)} at ${p.score.toFixed(2)}, session ${code(p.sessionId)}, receipt ${code(p.receiptDigest)}</li>`).join('\n');
const limits = a.limits.map(l => `<li>${esc(l)}</li>`).join('\n');
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
      keywords: ['Apple Neural Engine', 'Core ML', 'LFM3'] }
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
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${URL_}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
<div class="wrap">
<a class="wordmark" href="/"><span class="wordmark-name">MacBrains Labs</span><span class="wordmark-desc">Apple Silicon research</span></a>
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
<header class="page-head" data-tag="${tag}">
<div class="wrap">
<p class="crumbs"><a href="/">MacBrains Labs</a> / <a href="/research/">Research record</a> / Record ${esc(a.version)}</p>
<h1>${esc(a.title)}</h1>
<p class="lede">A diagnostic research record, reviewed and then republished byte for byte. ${esc(scopeLabel)}. ANE execution INFERRED from Core ML compute-plan placement; no novelty claim.</p>
<dl class="facts">
<div><dt>Version</dt><dd>${esc(a.version)} · released <time datetime="${released}">${human(released)}</time></dd></div>
<div><dt>Device</dt><dd>${esc(deviceLine)}</dd></div>
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
<li><a href="#claim">Claim</a></li>
<li><a href="#limits">Limits</a></li>
<li><a href="#runs">Every execution</a></li>
<li><a href="#review">Review</a></li>
<li><a href="#files">Files</a></li>
</ol>
<div class="toc-out"><a href="/publications/">Publications</a><a href="/methods/">Methodology</a></div>
</nav>
<article class="article">
<h2 id="scope"><span class="sec">01</span>Scope</h2>
<div class="callout"><span class="label">Scope as reviewed</span><p><q>${esc(a.claimScope)}</q></p></div>
<p><strong>${esc(scopeLabel)}.</strong> Every execution in this record ran on one device, the same chip. Device identity is ${esc(dev.identitySource)}. Novelty is ${esc(a.noveltyClaim)}.</p>

<h2 id="claim"><span class="sec">02</span>Claim, verbatim</h2>
<p>${esc(a.claim)}</p>

<h2 id="limits"><span class="sec">03</span>What the record does not say</h2>
<ul>
${limits}
</ul>

<h2 id="runs"><span class="sec">04</span>Every execution of the setup profile</h2>
<p>Setup profile ${code(r.profileHash)} was hashed and committed before the first counted run. The device log lists ${r.logged} logged executions of it: ${r.counted} counted and git-frozen, ${r.preFreeze} before the profile froze and not counted. The output of ${r.deleted} counted run was deleted from the device; its recovered record and the cause analysis are in ${code('deletion-disclosure.md')}. No execution is omitted.</p>
<div class="table-scroll" tabindex="0"><table class="data-table">
<thead><tr><th scope="col">Run</th><th scope="col">Tool commit</th><th scope="col">Started (UTC)</th><th scope="col">Status</th><th scope="col">Counted</th><th scope="col">Output</th></tr></thead>
<tbody>
${runRows}
</tbody></table></div>
<p class="table-caption">From ${code('execution-log.jsonl')}, republished exactly as reviewed. The log on the device is append-only; the one correction shown was appended after review. ${esc(corrections.get('pf-toolrun')?.basis ?? '')}</p>

<h2 id="review"><span class="sec">05</span>Review and bindings</h2>
<ul>
<li>Reviewed package ${code(a.reviewedPackage.sha256)}: the hand-off manifest the final reviewer read. It is not republished; it binds the files below by hash.</li>
<li>Final review: ${esc(a.finalReview.decision)} from ${code(a.finalReview.reviewer)} for that package hash, verdict receipt ${code(a.finalReview.verdictReceiptSha256)}.</li>
${reviews}
<li>Reviewed bundle ${code(a.bundle.sha256)}, round ${a.bundle.round}, schema ${code(a.bundle.schema)}.</li>
<li>Diagnostic policy digest ${code(a.policy.digest)} at commit ${code(a.policy.commit)}.</li>
</ul>
<p>A reviewed record and an archived DOI are not peer review. ${doiPara}</p>

<h2 id="files"><span class="sec">06</span>Files</h2>
<div class="table-scroll" tabindex="0"><table class="data-table">
<thead><tr><th scope="col">File at the tag</th><th scope="col" class="numeric">Bytes</th><th scope="col">SHA-256</th></tr></thead>
<tbody>
${fileRows}
</tbody></table></div>
<p class="table-caption">The <a href="${REPO}/releases/tag/${tag}">GitHub release ${esc(tag)}</a> carries the same files with <code>SHA256SUMS</code>; <code>scripts/verify.mjs</code> in the <a href="${REPO}">record repository</a> re-checks every hash and claim field.</p>
</article>
</div>
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
