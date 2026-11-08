#!/usr/bin/env node
// Static public evidence index and newcomer guide, derived from already-published
// research and publication files. No private ledger, model artifact, or new claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { socialPathForRoute } from './social-path.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plain = s => String(s).replace(/<br\s*\/?\s*>/gi, ' / ').replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const safePath = url => { assert.match(url, /^\/(?:notes|research|evidence)\/[a-z0-9/_-]*\/?(?:#[a-z0-9_-]+)?$/i); return url; };

function metrics() {
  const html = read('research/index.html');
  const first = html.match(/<table class="data-table">([\s\S]*?)<\/table>/);
  assert.ok(first, 'research summary table missing');
  const body = first[1].match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(body, 'measurement table tbody missing');
  const classes = new Map([
    ['MLComputePlan / infer', 'planner'],
    ['ANE-assigned state primitives', 'planner'],
    ['Aggregate tokens per second', 'measured'],
    ['WikiText-2 perplexity', 'measured'],
    ['ANE compute placement', 'planner'],
    ['ANE vs fixture relative L2', 'measured']
  ]);
  const rows = [...body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  assert.ok(rows.length >= 6, 'research summary unexpectedly missing measurements');
  return rows.map((m, i) => {
    const td = [...m[1].matchAll(/<td(?: [^>]+)?>([\s\S]*?)<\/td>/g)].map(x => plain(x[1].replace(/\s*(?:See\s+)?<a\b[^>]*>(?:(?!<a\b)[\s\S])*?<\/a>\.?\s*$/i, '')));
    assert.equal(td.length, 4, 'unexpected measurement table format row ' + i);
    const [title, observation, value, limitation] = td;
    const type = classes.get(observation);
    assert.ok(type, 'new observation type requires explicit epistemic classification: ' + observation);
    return { id: 'measurement-' + (i + 1), kind: type, title, observation, value, limitation, url: '/research/#measurements', source: 'Public research summary', tag: /Qwen/i.test(title) ? 'Qwen2.5' : /LFM/i.test(title) ? 'LFM' : 'Research' };
  });
}
function notes() {
  const html = read('notes/index.html');
  const rx = /<li><a href="(\/notes\/[a-z0-9/_-]+\/)"><span class="id">([^<]+)<\/span><div><h2>([\s\S]*?)<\/h2><p>([\s\S]*?)<\/p><\/div><span class="tags">([\s\S]*?)<\/span><\/a><\/li>/gi;
  const out = [...html.matchAll(rx)].map(m => ({
    id: 'note-' + plain(m[2]), kind: 'note', title: plain(m[3]), observation: 'Research note', value: plain(m[5]), limitation: plain(m[4]), url: safePath(m[1]), source: 'Public note ' + plain(m[2]), tag: plain(m[5])
  }));
  assert.ok(out.length >= 5, 'public notes list unexpectedly incomplete');
  return out;
}
function archives() {
  const feed = JSON.parse(read('publications/publications.json'));
  assert.equal(feed.schema, 'macbrainslabs.publications.v1', 'unrecognized verified feed schema');
  return feed.records.map(r => {
    assert.equal(r.verification?.state, 'verified', 'never expose a publication without a verified archive record');
    const title = r.title || r.zenodo_title;
    assert.ok(title && r.tag && r.doi?.version_doi && r.release_url);
    const link = r.record_url || r.release_url;
    assert.ok(link.startsWith('https://macbrainslabs.org/') || link.startsWith('https://github.com/macbrainslabs/ane-research-records/'), 'unrecognized archive link');
    return {
      id: 'archive-' + r.tag, kind: 'archive', title,
      observation: 'Published archive integrity: verified',
      value: r.version || r.tag,
      limitation: r.replication?.claim || (r.record_class ? r.record_class + '; archive integrity is not independent replication or peer review' : 'Published source-bound record. Archive integrity is not independent replication or peer review.'),
      url: link, source: 'Published release and DOI ' + r.doi.version_doi,
      tag: r.kind === 'ane-diagnostic' ? 'LFM3' : r.kind === 'ane-package' ? 'ANERECore' : 'Archive'
    };
  });
}

function buildCatalog() {
  const items = [...metrics(), ...notes(), ...archives()];
  assert.equal(items.length, new Set(items.map(x => x.id)).size, 'duplicate evidence IDs');
  for (const x of items) assert.ok(x.title && x.observation && x.limitation && x.url && x.source);
  return {
    schema: 'macbrainslabs.public-evidence-index.v1',
    generated_from: ['research/index.html', 'notes/index.html', 'publications/publications.json'],
    classification: {
      planner: 'Public planner/API assignment observations; not a physical ANE trace',
      measured: 'Specific experiment measurements, not general benchmark guarantees',
      note: 'Source-bound note, possibly a negative result or interpretation',
      archive: 'Published release integrity, not peer review or independent replication'
    },
    items
  };
}

function documentShell(route, title, description, contents, script = '') {
  const template = read('notes/index.html');
  const start = template.indexOf('<main id="main">');
  const end = template.indexOf('</main>', start) + '</main>'.length;
  assert.ok(start > -1 && end > start, 'canonical site shell unavailable');
  let before = template.slice(0, start);
  let after = template.slice(end);
  const sub = (needle, replacement) => { assert.ok(typeof needle === 'string' ? before.includes(needle) : needle.test(before), 'template missing ' + needle); before = before.replace(needle, replacement); };
  sub(/<title>[^<]+<\/title>/, '<title>' + escapeHtml(title) + ' · MacBrains Labs</title>');
  sub(/<meta name="description" content="[^"]+">/, '<meta name="description" content="' + escapeHtml(description) + '">');
  sub(/<meta property="og:title" content="[^"]+">/, '<meta property="og:title" content="' + escapeHtml(title) + '">');
  sub(/<meta property="og:description" content="[^"]+">/, '<meta property="og:description" content="' + escapeHtml(description) + '">');
  sub(/<meta property="og:url" content="[^"]+">/, '<meta property="og:url" content="https://macbrainslabs.org' + route + '">');
  sub(/<link rel="canonical" href="[^"]+">/, '<link rel="canonical" href="https://macbrainslabs.org' + route + '">');
  const socialUrl = 'https://macbrainslabs.org' + socialPathForRoute(route);
  before = before.replace(/<meta property="og:image" content="[^"]+">/, '<meta property="og:image" content="' + socialUrl + '">');
  before = before.replace(/<meta property="og:image:secure_url" content="[^"]+">/, '<meta property="og:image:secure_url" content="' + socialUrl + '">');
  before = before.replace(/<meta name="twitter:image" content="[^"]+">/, '<meta name="twitter:image" content="' + socialUrl + '">');
  before = before.replace(/<meta property="og:image:alt" content="[^"]+">/, '<meta property="og:image:alt" content="MacBrains Labs research: ' + escapeHtml(title) + '">');
  before = before.replace(/<meta name="twitter:image:alt" content="[^"]+">/, '<meta name="twitter:image:alt" content="MacBrains Labs research: ' + escapeHtml(title) + '">');
  sub('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css">\n<link rel="stylesheet" href="/experience.css">' + (script ? '\n<script src="' + script + '" defer></script>' : ''));
  before = before.replace('aria-current="page">Notes</a>', '>Notes</a>');
  before = before.replace('"name": "Notes"', '"name": "' + (route === '/start/' ? 'Start here' : 'Evidence explorer') + '"').replace('"item": "https://macbrainslabs.org/notes/"', '"item": "https://macbrainslabs.org' + route + '"');
  return before + '<main id="main">\n' + contents + '\n</main>' + after;
}

function explorer(catalog) {
  const types = { planner: 'Planner reported', measured: 'Measured', note: 'Note', archive: 'Verified archive' };
  const counts = Object.fromEntries(Object.keys(types).map(x => [x, catalog.items.filter(i => i.kind === x).length]));
  const cards = catalog.items.map(x => {
    const data = escapeHtml([x.title,x.observation,x.value,x.limitation,x.source,x.tag].join(' ').toLocaleLowerCase('en-US'));
    const kind = escapeHtml(x.kind);
    const url = escapeHtml(x.url);
    return `<article class="evidence-card" data-kind="${kind}" data-search="${data}">
<div class="evidence-meta"><span class="evidence-type evidence-type-${kind}">${types[x.kind]}</span><span>${escapeHtml(x.tag)}</span></div>
<h3>${escapeHtml(x.title)}</h3>
<p class="evidence-observation">${escapeHtml(x.observation)}<span class="evidence-value">${escapeHtml(x.value)}</span></p>
<p class="evidence-limit">${escapeHtml(x.limitation)}</p>
<a class="evidence-link" href="${url}">${escapeHtml(x.source)} <span aria-hidden="true">↗</span></a>
</article>`;
  }).join('\n');
  const content = `<header class="experience-hero">
<div class="wrap"><p class="kicker">The public record</p><p class="crumbs"><a href="/">MacBrains Labs</a> / Evidence explorer</p>
<div class="experience-hero-grid"><div><h1>Search the evidence.</h1>
<p class="experience-lede">Search my measurements, notes and verified archive releases. Every entry links back to its public source.</p>
<div class="experience-actions"><a href="/start/">New to the Neural Engine? Start with the guide ↗</a><a href="/methods/">Read my methods ↗</a></div></div>
<aside class="experience-index" aria-label="Evidence classifications"><span class="kicker">What’s indexed</span><strong>${catalog.items.length} <span>public entries</span></strong>
<dl><div><dt>Measured</dt><dd>${counts.measured}</dd></div><div><dt>Planner reported</dt><dd>${counts.planner}</dd></div><div><dt>Notes</dt><dd>${counts.note}</dd></div><div><dt>Verified archives</dt><dd>${counts.archive}</dd></div></dl>
<p>This index comes from the published research summary, the note index and the last known good archive feed. It doesn’t create or validate any experiment.</p></aside></div>
</div></header>
<section class="wrap evidence-section" aria-labelledby="index-h"><div class="experience-section-head"><span class="kicker">Public evidence index</span><div><h2 id="index-h">Browse the entries</h2><p>Measurements, compiler assignments, interpretations and archive integrity are different kinds of evidence.</p></div></div>
<form class="evidence-controls" role="search" id="evidence-controls" hidden>
<label for="evidence-query">Search records</label><input id="evidence-query" type="search" autocomplete="off" placeholder="Model, metric, result, source..." aria-controls="evidence-list">
<label for="evidence-filter">Evidence kind</label><select id="evidence-filter" aria-controls="evidence-list">
<option value="all">All public entries</option><option value="measured">Measured</option><option value="planner">Planner reported</option><option value="note">Notes</option><option value="archive">Verified archives</option>
</select><button type="reset">Clear</button></form>
<p class="evidence-count" id="evidence-count" aria-live="polite">${catalog.items.length} entries from published sources</p>
<div class="evidence-grid" id="evidence-list">${cards}</div>
<p class="evidence-empty" id="evidence-empty" hidden>Nothing published matches these filters. Try a broader search.</p></section>
<section class="experience-bottom"><div class="wrap experience-bottom-grid"><div><span class="kicker">How to read it</span><h2>Each kind means something different.</h2></div><div>
<p><strong>Planner reported:</strong> the compute unit Core ML assigns. It isn’t a physical trace of the Neural Engine.</p>
<p><strong>Measured:</strong> an observed result for a named model, device, compiler and method. It doesn’t generalize automatically.</p>
<p><strong>Note:</strong> my engineering interpretation. It includes counterexamples and failed hypotheses.</p>
<p><strong>Verified archive:</strong> release provenance and file integrity. A DOI doesn’t imply peer review or independent replication.</p>
<a href="/research/">See the full research record ↗</a></div></div></section>`;
  return documentShell('/research/explore/','Research evidence explorer', 'Browse source-linked Apple Neural Engine measurements, Core ML planner observations, notes, and verified research archives with clear evidence boundaries.', content, '/explore.js');
}

function guide() {
  const content = `<header class="experience-hero">
<div class="wrap"><p class="kicker">Start here</p><p class="crumbs"><a href="/">MacBrains Labs</a> / Start here</p>
<div class="experience-hero-grid"><div><h1>How to read this research.</h1>
<p class="experience-lede">A one-minute map of my research. You don’t need Core ML or the Apple Neural Engine to read the evidence.</p>
<div class="experience-actions"><a href="/research/explore/">Open the evidence explorer ↗</a><a href="/research/">Read the full research record ↗</a></div></div>
<aside class="experience-index" aria-label="Guide overview"><span class="kicker">The short version</span><strong>4 <span>questions</span></strong><p>What ran? Where was it assigned? Was it correct? Did it actually get faster?</p><p>Each question needs a different test. A result for one doesn’t prove the others.</p></aside></div></div></header>
<section class="wrap guide-section" aria-labelledby="guide-title"><div class="experience-section-head"><span class="kicker">The basics</span><div><h2 id="guide-title">The four questions.</h2><p>Think of the Neural Engine as one place a computation can run. It doesn’t guarantee correct results or speed.</p></div></div>
<div class="guide-grid">
<article><span class="guide-n">Build</span><h3>What actually ran?</h3><p>Core ML compiles a model graph. Small changes to the graph’s structure, its shapes or its diagnostics can change the compiled result. So I name the exact artifact and configuration.</p><a href="/methods/">How I document the artifacts ↗</a></article>
<article><span class="guide-n">Place</span><h3>Where was it assigned?</h3><p>Apple’s Core ML planner may report which operations are assigned to the ANE, the CPU or the GPU. That’s useful placement evidence. It isn’t a low-level trace that proves each operation physically ran on the ANE.</p><a href="/evidence/qwen-placement/">Look at a placement receipt ↗</a></article>
<article><span class="guide-n">Compare</span><h3>Was the output correct?</h3><p>A model can compile and get an ANE assignment, then still fail an output parity test. I compare exact outputs against declared fixtures, using defined numerical tolerances.</p><a href="/notes/lfm-parity/">Read a passing and failing comparison ↗</a></article>
<article><span class="guide-n">Measure</span><h3>Did it get faster?</h3><p>Throughput depends on batch shape, dispatch cost, memory and what was timed. A speed measurement doesn’t validate model quality or the claims made about deployment.</p><a href="/notes/decode-regimes/">See a speed hypothesis I got wrong ↗</a></article>
</div></section>
<section class="experience-bottom"><div class="wrap experience-bottom-grid"><div><span class="kicker">Labels</span><h2>What each label means.</h2></div><div>
<p><strong>Measured</strong> means it was observed under a named setup. <strong>Planner reported</strong> describes what the compiler planned, not an ANE hardware trace.</p>
<p><strong>Source-bound</strong> means the published claim links to its artifacts or documented receipts. <strong>Verified archive</strong> means the published files and identifiers passed the stated integrity checks. That isn’t peer review.</p>
<p>Negative results, incomplete chains and changes to an earlier hypothesis belong in the research record.</p>
<a href="/research/explore/">Search all public entries ↗</a><p class="guide-final-note">Independent Apple Silicon research. I’m not affiliated with Apple.</p></div></div></section>`;
  return documentShell('/start/','Start here: reading ANE research', 'A concise guide to understanding Apple Neural Engine placement, numerical correctness, performance measurements, and research evidence.', content);
}

const catalog = buildCatalog();
const outputs = {
  'research/explore/catalog.json': JSON.stringify(catalog,null,2) + '\n',
  'research/explore/index.html': explorer(catalog),
  'start/index.html': guide()
};
const check = process.argv.includes('--check');
for (const [name, data] of Object.entries(outputs)) {
  const dest = path.join(root,name);
  if (check) {
    assert.equal(fs.readFileSync(dest,'utf8'), data, name + ' is stale: regenerate from the published sources');
  } else {
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.writeFileSync(dest,data);
    console.log('GENERATED',name,data.length + ' bytes');
  }
}
console.log(check ? 'PASS current public index and guide match published sources' : 'PASS generated ' + catalog.items.length + ' source-linked entries');
