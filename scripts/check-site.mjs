#!/usr/bin/env node
// Dependency-free regression check for the custom-domain static research site.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = 'https://macbrainslabs.org';
const root = process.cwd();
const pages = ['/', '/research/', '/methods/', '/publications/', '/contact/', '/notes/', '/notes/qwen-lut4/', '/notes/lfm-parity/', '/notes/decode-regimes/', '/notes/lfm-chain/', '/notes/graft-costs/', '/evidence/qwen-placement/', '/security/', '/security/archive-path-traversal/', '/security/evidence-validation/'];
const assets = ['/404.html', '/styles.css', '/home.css', '/assets/brand-mark-96.png', '/assets/notch-v13.mp4', '/assets/notch-first.webp', '/assets/notch-still.webp', '/favicon.svg', '/sitemap.xml', '/robots.txt', '/.well-known/security.txt', '/security/evidence/results.json', '/security/evidence/README.md', '/security/evidence/SHA256SUMS', '/publications/publications.json'];
const failures = [];
let checks = 0;
function check(label, fn) { checks++; try { fn(); console.log(`PASS ${label}`); } catch (e) { failures.push(`${label}: ${e.message}`); console.error(`FAIL ${label}: ${e.message}`); } }
function fileFor(route) { return path.join(root, route === '/' ? 'index.html' : route.endsWith('/') ? `${route}index.html` : route); }
function read(route) { return fs.readFileSync(fileFor(route), 'utf8'); }
for (const urlPath of pages) {
  const label = `page ${urlPath}`;
  check(`${label} exists`, () => assert.ok(fs.existsSync(fileFor(urlPath))));
  const html = read(urlPath);
  check(`${label} canonical`, () => assert.ok(html.includes(`<link rel="canonical" href="${base}${urlPath}">`)));
  check(`${label} OpenGraph URL`, () => assert.ok(html.includes(`content="${base}${urlPath}"`)));
  check(`${label} basic landmarks`, () => {
    assert.ok(html.includes('<main id="main">'));
    assert.ok(html.includes('href="#main"'));
    assert.ok(html.includes('aria-label="Main navigation"'));
  });
  check(`${label} linked files`, () => {
    for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const url = m[1].split('#')[0].split('?')[0];
      assert.ok(fs.existsSync(fileFor(url)), `${m[1]} unresolved`);
    }
  });
  check(`${label} no stale host or project prefix`, () => {
    assert.ok(!html.includes('/macbrainslabs-site/'));
    assert.ok(!html.includes('naytewilson.github.io/macbrainslabs-site'));
  });
}
check('research JSON-LD parses and names DOI and ORCID', () => {
  const m = read('/research/').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'no JSON-LD block');
  const d = JSON.parse(m[1]);
  assert.equal(d['@type'], 'Dataset');
  assert.equal(d.identifier, 'https://doi.org/10.5281/zenodo.23798037');
  assert.equal(d.creator.identifier, 'https://orcid.org/0009-0003-4026-8212');
});
check('public advisory files match checksums and recorded observation relationships', () => {
  const dir = path.join(root, 'security/evidence');
  for (const line of fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const m = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/);
    assert.ok(m, 'malformed checksum entry');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, m[2]))).digest('hex'), m[1], m[2]);
  }
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  for (const item of data.cases) {
    assert.ok(fs.existsSync(fileFor(new URL(item.url).pathname)));
    for (const row of item.observations) {
      assert.equal(row.commit, data.source_revisions[row.source]);
      if ('sentinel_preserved' in row) {
        assert.match(row.sentinel_before_sha256, /^[a-f0-9]{64}$/);
        assert.match(row.sentinel_after_sha256, /^[a-f0-9]{64}$/);
        assert.equal(row.sentinel_preserved, row.sentinel_before_sha256 === row.sentinel_after_sha256);
      }
    }
  }
  const paths = data.cases[0].observations;
  assert.deepEqual(paths.map(r => `${r.source}:${r.input}`).sort(), ['main:benign', 'main:traversal', 'parent:benign', 'parent:traversal', 'repair:benign', 'repair:traversal']);
  assert.ok(paths.filter(r => r.input === 'benign').every(r => r.sentinel_preserved));
  assert.deepEqual(paths.filter(r => !r.sentinel_preserved).map(r => r.source), ['parent']);
  assert.equal(data.cases[1].synthetic_input, true);
  assert.deepEqual(data.cases[1].observations.map(r => r.has_falsifier), [false, true, true]);
  // Frozen recorded totals independently compared with the original private logs.
  assert.deepEqual(data.cases.map(c => [c.regression.pinned_main, c.regression.parent_with_current_fixture]), [
    [{passed:14, failed:0}, {passed:11, failed:3}],
    [{passed:45, failed:0}, {passed:38, failed:7}]
  ]);
  const passed = data.cases.reduce((n, c) => n + c.regression.pinned_main.passed, 0);
  const total = passed + data.cases.reduce((n, c) => n + c.regression.pinned_main.failed, 0);
  assert.ok(read('/security/').includes(`<span class="result-value">${passed}<small>/ ${total}</small></span>`));
});
check('security.txt has required RFC 9116 fields and a future Expires', () => {
  const t = fs.readFileSync(path.join(root, '.well-known/security.txt'), 'utf8');
  assert.match(t, /^Contact: mailto:research@macbrainslabs\.org$/m);
  const exp = t.match(/^Expires: (.+)$/m);
  assert.ok(exp && Date.parse(exp[1]) > Date.now(), 'Expires missing or past');
});
check('contact mailto on every page', () => {
  for (const route of pages) assert.ok(read(route).includes('href="mailto:research@macbrainslabs.org"'), `missing on ${route}`);
});
check('home media is local, silent, player-free and still under reduced motion', () => {
  const html = read('/');
  for (const m of html.matchAll(/\s(?:src|srcset|poster)="([^"]+)"/g)) {
    for (const u of m[1].split(',').map(x => x.trim().split(/\s+/)[0])) {
      assert.ok(u.startsWith('/') && !u.startsWith('//'), `non-local media ${u}`);
      assert.ok(fs.existsSync(path.join(root, u)), `missing ${u}`);
    }
  }
  assert.ok(!/<(audio|iframe)\b/.test(html), 'home must not embed audio or frames');
  assert.ok(/<div class="notch-frame" role="img" aria-label="[^"]{20,}">/.test(html), 'Notch frame needs a description');
  const vids = [...html.matchAll(/<video\b([^>]*)>/g)].map(m => m[1]);
  assert.equal(vids.length, 1, 'expected exactly one Notch video');
  for (const a of vids) {
    for (const attr of ['muted', 'playsinline', 'autoplay']) assert.ok(new RegExp('\\s' + attr + '\\b').test(a), `video needs ${attr}`);
    assert.ok(!/\s(controls|loop)\b/.test(a), 'video must show no player and play once');
    assert.ok(/\sposter="\/assets\/[^"]+"/.test(a) && /\saria-hidden="true"/.test(a), 'video needs a local poster and is described by its frame');
  }
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) assert.ok(/\swidth="\d+"/.test(m[1]) && /\sheight="\d+"/.test(m[1]) && /\salt="/.test(m[1]), `img needs width, height and alt: ${m[0].slice(0, 80)}`);
  assert.ok(/<img class="notch-still" src="[^"]+\.webp"[^>]*\salt="[^"]{20,}"[^>]*loading="lazy"/.test(html), 'Notch needs a described, lazy still');
  assert.ok(/@media\(prefers-reduced-motion:reduce\)\{[^@]*\.notch-frame \.notch-video\{display:none\}\.notch-frame \.notch-still\{display:block\}/.test(read('/home.css')), 'reduced motion must swap the video for the still');
  assert.ok(!/name="robots"/.test(html), 'home must stay indexable');
});
check('placement figure cell counts match its data', () => {
  const html = read('/');
  const svgs = [...html.matchAll(/<svg class="ledger[^"]*"[^>]*data-ane="(\d+)" data-cpu="(\d+)"[^>]*>([\s\S]*?)<\/svg>/g)];
  assert.ok(svgs.length > 0, 'no placement figure');
  for (const [, ane, cpu, body] of svgs) {
    const cells = { ane: 0, cpu: 0 };
    for (const r of body.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)" fill="url\(#[a-z]+-(ane|cpu)\)"\/>/g)) cells[r[3]] += (r[1] / 6) * (r[2] / 6);
    assert.equal(cells.ane, Number(ane)); assert.equal(cells.cpu, Number(cpu));
  }
});
check('evidence bundle tools match their recorded hashes and counts', () => {
  const dir = path.join(root, 'evidence/qwen-placement');
  const prov = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
  for (const t of prov.tools) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, t.file))).digest('hex'), t.sha256, t.file);
  const r = prov.recorded_result;
  assert.equal(r.none + r.ANE + r.CPU + r.GPU, r.total_ops);
  assert.equal(r.ANE + r.CPU + r.GPU, r.assigned_compute_ops);
  assert.ok(read('/').includes(`data-ane="${r.ANE}" data-cpu="${r.CPU}"`), 'home figure disagrees with provenance.json');
  const runs = [prov.rerun_2026_10_30, prov.archived_june_copy_rerun_2026_10_30, prov.shipped_prefill_rerun_2026_10_30];
  for (const q of runs) {
    const raw = fs.readFileSync(path.join(dir, q.raw_output.file));
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), q.raw_output.sha256, `${q.raw_output.file} hash`);
    const x = q.result, txt = raw.toString();
    assert.equal(x.none + x.ANE + x.CPU + x.GPU, x.total_ops);
    assert.equal(x.ANE + x.CPU + x.GPU, x.assigned_compute_ops);
    assert.ok(txt.includes(`function: ${x.function}`) && txt.includes(`total ops: ${x.total_ops}`) && txt.includes(`ANE  ${x.ANE}  (`) && txt.includes(`CPU    ${x.CPU}  (`), `${q.raw_output.file} counts disagree with raw output`);
    for (const [op, v] of Object.entries(x.kv_state)) assert.ok(txt.includes(v.CPU ? `${op} ANE=${v.ANE}  CPU=${v.CPU}\n` : `${op} ANE=${v.ANE}\n`), `${q.raw_output.file} ${op}`);
  }
  const j = prov.archived_june_copy_rerun_2026_10_30.result;
  for (const k of ['total_ops','none','ANE','CPU','GPU']) assert.equal(j[k], r[k], `June copy ${k} differs from the recorded result`);
  assert.deepEqual(j.kv_state, r.kv_state, 'June copy KV counts differ from the recorded result');
});
const jsonLd = route => [...read(route).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const nodes = route => jsonLd(route).flatMap(d => d['@graph'] ?? [d]);
const plain = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
for (const route of pages) {
  check(`structured data ${route} parses, uses schema.org and points at real pages`, () => {
    const docs = jsonLd(route);
    assert.ok(docs.length > 0, 'no JSON-LD');
    for (const d of docs) {
      assert.equal(d['@context'], 'https://schema.org');
      for (const m of JSON.stringify(d).matchAll(/"(https:\/\/macbrainslabs\.org[^"#]*)/g)) {
        const u = new URL(m[1]).pathname;
        assert.ok(fs.existsSync(fileFor(u)), `${m[1]} has no page`);
      }
    }
  });
  if (route !== '/') check(`structured data ${route} breadcrumbs match the visible trail`, () => {
    const crumbs = read(route).match(/<p class="crumbs">([\s\S]*?)<\/p>/)[1].split(' / ');
    const list = nodes(route).find(n => n['@type'] === 'BreadcrumbList');
    assert.ok(list, 'no BreadcrumbList');
    assert.equal(list.itemListElement.length, crumbs.length);
    crumbs.forEach((c, i) => {
      const it = list.itemListElement[i];
      assert.equal(it.position, i + 1);
      assert.equal(it.name, plain(c));
      assert.equal(it.item, `${base}${c.match(/href="([^"]+)"/)?.[1] ?? route}`);
    });
  });
  const art = nodes(route).find(n => n['@type'] === 'TechArticle');
  if (art) check(`structured data ${route} article matches the page`, () => {
    const html = read(route);
    assert.equal(art.headline, plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]));
    assert.equal(art.url, `${base}${route}`);
    assert.equal(art.description, html.match(/<meta name="description" content="([^"]*)">/)[1]);
    const times = [...html.matchAll(/<dt>(Published|Revised)<\/dt><dd><time datetime="([^"]+)">([^<]+)<\/time>/g)].map(m => [m[1], m[2], m[3]]);
    if (art.datePublished) {
      const iso = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/, day = d => d.slice(0, 10);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (const d of [art.datePublished, art.dateModified]) assert.match(d, iso, `${d} is not a full ISO 8601 datetime with offset`);
      for (const [, dt, text] of times) {
        const [, y, mo, da] = dt.match(iso) ?? assert.fail(`visible ${dt} is not a full datetime with offset`);
        assert.equal(text, `${+da} ${months[mo - 1]} ${y}`, `visible date text ${text} does not match ${dt}`);
      }
      const shown = kind => times.find(t => t[0] === kind)?.[1];
      assert.equal(shown('Published'), art.datePublished, 'datePublished not shown on the page');
      if (shown('Revised')) {
        assert.equal(shown('Revised'), art.dateModified, 'dateModified not shown on the page');
        assert.notEqual(day(art.dateModified), day(art.datePublished), 'Revised shown for a same-day change');
      } else assert.equal(day(art.dateModified), day(art.datePublished), 'a later-day dateModified needs a visible Revised date');
      assert.ok(Date.parse(art.dateModified) >= Date.parse(art.datePublished));
    } else assert.equal(times.length, 0, 'visible dates without datePublished');
  });
}
check('home structured data names the organization and website', () => {
  const n = nodes('/');
  const org = n.find(x => x['@type'] === 'Organization'), site = n.find(x => x['@type'] === 'WebSite');
  assert.ok(org && site);
  assert.equal(org.email, 'research@macbrainslabs.org');
  assert.equal(site.publisher['@id'], org['@id']);
});
check('titles and descriptions are unique and descriptions fit a result snippet', () => {
  const t = pages.map(r => read(r).match(/<title>([^<]*)<\/title>/)[1]);
  const d = pages.map(r => read(r).match(/<meta name="description" content="([^"]*)">/)[1]);
  assert.equal(new Set(t).size, t.length, 'duplicate title');
  assert.equal(new Set(d).size, d.length, 'duplicate description');
  pages.forEach((r, i) => assert.ok(d[i].length <= 200, `${r} description ${d[i].length} chars`));
  pages.forEach(r => { const h = read(r); assert.equal(h.match(/<meta property="og:description" content="([^"]*)">/)[1], h.match(/<meta name="description" content="([^"]*)">/)[1], `${r} og:description differs`); });
});
check('404 page is noindex, unlisted and self-contained', () => {
  const html = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('<main id="main">') && html.includes('aria-label="Main navigation"'));
  assert.ok(html.includes('href="mailto:research@macbrainslabs.org"'));
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) assert.ok(fs.existsSync(fileFor(m[1].split('#')[0])), `${m[1]} unresolved`);
  assert.ok(!read('/sitemap.xml').includes('404'));
  for (const r of pages) assert.ok(!read(r).includes('name="robots"'), `${r} has a robots meta`);
});
check('CNAME preserved', () => assert.equal(fs.readFileSync('CNAME','utf8').trim(), 'macbrainslabs.org'));
check('robots canonical sitemap', () => assert.ok(read('/robots.txt').includes(`Sitemap: ${base}/sitemap.xml`)));
check('sitemap canonical URLs', () => {
  const xml = read('/sitemap.xml');
  for(const route of pages) assert.ok(xml.includes(`<loc>${base}${route}</loc>`), `missing ${route}`);
  assert.ok(!xml.includes('naytewilson.github.io'));
});
// -- Publications release feed contract --------------------------------------
const PUB_LINK_HOSTS = ['github.com', 'zenodo.org', 'doi.org', 'macbrainslabs.org', 'orcid.org'];
const pubClean = (s, what, max = 400) => {
  assert.ok(typeof s === 'string' && s.length > 0 && s.length <= max, `${what}: missing or oversized`);
  assert.ok(!/[<>"]/.test(s) && !/[\u0000-\u001f\u007f]/.test(s), `${what}: contains angle/quote/control characters`);
  return s;
};
const pubUrl = (u, what) => {
  let p;
  try { p = new URL(u); } catch { throw new Error(`${what}: unparseable URL`); }
  assert.equal(p.protocol, 'https:', `${what}: not https`);
  assert.ok(PUB_LINK_HOSTS.includes(p.host), `${what}: ${p.host} outside the link allowlist`);
  assert.ok(!p.username && !p.password, `${what}: userinfo in URL`);
};

const pubs = (() => {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'publications/publications.json'), 'utf8'));
  check('publications feed schema and policy', () => {
    assert.equal(d.schema, 'macbrainslabs.publications.v1');
    assert.match(d.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u);
    assert.equal(d.source.release_repository, 'macbrainslabs/ane-research-records');
    assert.equal(d.source.site_repository, 'https://github.com/naytewilson/macbrainslabs-site');
    assert.equal(d.source.researcher_orcid, '0009-0003-4026-8212');
    for (const [k, v] of Object.entries(d.policy)) pubClean(v, `policy ${k}`, 600);
    assert.ok(['ok', 'partial'].includes(d.upstream_status));
  });
  check('publications feed records are published, bounded and qualify', () => {
    assert.ok(Array.isArray(d.records) && d.records.length >= 1 && d.records.length <= 48, 'records out of bounds');
    const tags = new Set();
    for (const rec of d.records) {
      assert.ok(!tags.has(rec.tag), `duplicate tag ${rec.tag}`);
      tags.add(rec.tag);
      assert.match(rec.tag, /^v[0-9]+\.[0-9]+\.[0-9]+$/u, `bad tag ${rec.tag}`);
      pubClean(rec.release_name, `${rec.tag} release_name`, 300);
      pubClean(rec.record_class, `${rec.tag} record_class`, 200);
      pubClean(rec.zenodo_title, `${rec.tag} zenodo_title`, 300);
      assert.match(rec.published_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u, `${rec.tag}: published_at not ISO-UTC`);
      assert.ok(rec.published_at.slice(0, 10) >= '2026-01-01', `${rec.tag}: implausibly old record`);
    }
  });
  check('publications feed provenance is exact and re-checkable', () => {
    for (const rec of d.records) {
      assert.equal(rec.provenance.site_repository, 'https://github.com/naytewilson/macbrainslabs-site');
      assert.match(rec.provenance.site_commit, /^[a-f0-9]{40}$/u, `${rec.tag}: site_commit`);
      assert.ok(Array.isArray(rec.provenance.source_pages) && rec.provenance.source_pages.length >= 1 && rec.provenance.source_pages.length <= 16, `${rec.tag}: source_pages out of bounds`);
      for (const p of rec.provenance.source_pages) {
        pubClean(p.path, `${rec.tag} source path`, 200);
        assert.ok(!p.path.startsWith('/') && !p.path.includes('..'), `${rec.tag}: unsafe source path`);
        assert.match(p.sha256, /^[a-f0-9]{64}$/u, `${rec.tag}: fingerprint not sha256`);
        assert.ok(['match', 'mismatch', 'unreachable'].includes(p.fingerprint_check), `${rec.tag}: fingerprint state`);
        pubUrl(p.url, `${rec.tag} source url`);
      }
    }
  });
  check('publications feed DOI claims derive their registered state from the verified record', () => {
    for (const rec of d.records) {
      const doi = rec.doi;
      pubClean(doi.tagged_manifest_doi_status, `${rec.tag} tagged_manifest_doi_status`, 300);
      assert.ok(!('doi_status' in doi), `${rec.tag}: stale doi_status key must not exist`);
      assert.ok(['manifest at the tag', 'citation file at main', 'not issued'].includes(doi.binding_source), `${rec.tag}: binding_source`);
      assert.ok(['registered_verified', 'mismatch_detected', 'unverifiable_now', 'none'].includes(doi.registered_state), `${rec.tag}: registered_state enum`);
      const st = doi.crosscheck.state;
      assert.ok(['pass', 'mismatch', 'unreachable'].includes(st), `${rec.tag}: crosscheck state`);
      if (doi.binding_source === 'not issued') {
        assert.equal(doi.version_doi, null, `${rec.tag}: a not-issued binding must not carry a DOI`);
        assert.match(doi.tagged_manifest_doi_status, /^not issued/u, `${rec.tag}: not-issued binding expects the archived manifest state to start with "not issued"`);
        assert.equal(doi.registered_state, doi.crosscheck.state === 'unreachable' ? 'unverifiable_now' : 'none', `${rec.tag}: registered_state for a DOI-less record`);
        assert.notEqual(rec.verification.state, 'verified', `${rec.tag}: not-issued DOI cannot be verified`);
      } else {
        assert.match(doi.version_doi, /^10\.5281\/zenodo\.\d+$/u, `${rec.tag}: version_doi`);
        assert.match(doi.concept_doi, /^10\.5281\/zenodo\.\d+$/u, `${rec.tag}: concept_doi`);
        assert.notEqual(doi.version_doi, doi.concept_doi);
        pubUrl(doi.zenodo_record_url, `${rec.tag}: zenodo_record_url`);
        assert.equal(new URL(doi.zenodo_record_url).pathname, `/records/${doi.version_doi.split('.').at(-1)}`, `${rec.tag}: record URL does not match the version DOI`);
        if (doi.binding_source === 'citation file at main') {
          assert.ok('record_version_tag' in doi.crosscheck.comparisons, `${rec.tag}: citation-file binding must show the tag cross-check`);
          assert.ok('archive_reference' in doi.crosscheck.comparisons, `${rec.tag}: citation-file binding must show the archive cross-check`);
        }
        // A validated DOI must ALWAYS derive its state from the registration:
        assert.equal(doi.registered_state, { pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now' }[st], `${rec.tag}: registered_state must follow the crosscheck`);
        assert.ok(doi.registered_state !== 'none', `${rec.tag}: a bound DOI cannot have no registration state`);
        if (st === 'mismatch' || st === 'unreachable') assert.notEqual(rec.verification.state, 'verified', `${rec.tag}: verified record with a non-passing DOI crosscheck`);
      }
      if (st === 'pass') {
        for (const [k, v] of Object.entries(doi.crosscheck.comparisons)) assert.equal(v, 'match', `${rec.tag}: crosscheck ${k} not a match despite pass state`);
      }
    }
  });
  check('publications feed assets are checksummed archives', () => {
    for (const rec of d.records) {
      assert.ok(Array.isArray(rec.assets) && rec.assets.length >= 2, `${rec.tag}: asset list`);
      const names = new Set(rec.assets.map(a => a.name));
      assert.ok(names.has('SHA256SUMS'), `${rec.tag}: no SHA256SUMS asset`);
      for (const a of rec.assets) {
        assert.match(a.name, /^[A-Za-z0-9._-]+$/u, `${rec.tag}: asset name form`);
        assert.ok(Number.isInteger(a.size) && a.size > 0, `${rec.tag}: asset size`);
        assert.match(a.digest, /^sha256:[a-f0-9]{64}$/u, `${rec.tag}: asset registered digest`);
        pubUrl(a.url, `${rec.tag} asset url`);
        assert.ok(a.sha256 === null || /^[a-f0-9]{64}$/.test(a.sha256), `${rec.tag}: asset verified digest`);
      }
      assert.ok(typeof rec.sha256_sums.verified === 'boolean', `${rec.tag}: sha256_sums must be boolean`);
    }
  });
  check('publications feed verification states are self-consistent', () => {
    for (const rec of d.records) {
      assert.ok(['verified', 'degraded'].includes(rec.verification.state), `${rec.tag}: verification state`);
      assert.ok(Array.isArray(rec.verification.guards) && rec.verification.guards.length >= 2, `${rec.tag}: guards`);
      for (const g of rec.verification.guards) {
        pubClean(g.name, `${rec.tag} guard name`, 200);
        assert.ok(['pass', 'degraded'].includes(g.state), `${rec.tag}: guard state`);
      }
      const state = rec.verification.state;
      const guardDegraded = rec.verification.guards.some(g => g.state !== 'pass');
      if (state === 'verified') {
        assert.ok(!guardDegraded, `${rec.tag}: shown verified while a guard is degraded`);
        assert.equal(rec.sha256_sums.verified, true, `${rec.tag}: shown verified without a re-verified checksum file`);
        assert.equal(rec.doi.crosscheck.state, 'pass', `${rec.tag}: shown verified without a passing DOI cross-check`);
        for (const p of rec.provenance.source_pages) assert.equal(p.fingerprint_check, 'match', `${rec.tag}: shown verified without full fingerprint matches`);
        for (const a of rec.assets) assert.match(a.sha256 ?? 'x', /^[a-f0-9]{64}$/u, `${rec.tag}: verified record with unverified asset digest`);
      } else {
        assert.ok(guardDegraded || rec.doi.crosscheck.state !== 'pass' || rec.provenance.source_pages.some(p => p.fingerprint_check !== 'match') || !rec.sha256_sums.verified, `${rec.tag}: degraded with no identifiable degraded element`);
      }
      assert.ok(Array.isArray(rec.evidence_limits) && rec.evidence_limits.length >= 1, `${rec.tag}: evidence_limits`);
      pubClean(rec.evidence_limits.join(''), `${rec.tag} evidence_limits`, 400 * 12);
    }
  });
  const feedHtml = read('/publications/');
  check('publications page renders exactly the feed records', () => {
    for (const rec of d.records) assert.ok(feedHtml.includes(`data-tag="${rec.tag}"`), `${rec.tag} not rendered on the publications page`);
    assert.ok(feedHtml.includes(`data-generated="${d.generated_at}"`), 'feed page does not carry the feed generation stamp');
    assert.ok(feedHtml.includes(`data-state="${d.upstream_status}"`), 'feed page does not carry the upstream status');
    for (const rec of d.records) {
      for (const p of rec.provenance.source_pages) {
        if (p.fingerprint_check === 'match') assert.ok(feedHtml.includes(p.sha256), `${rec.tag}: fingerprint ${p.sha256.slice(0, 12)} not shown on the page`);
      }
      for (const a of rec.assets) {
        if (a.sha256) assert.ok(feedHtml.includes(a.sha256), `${rec.tag}: asset digest not shown`);
      }
    }
  });
  check('home publications block is bound to the feed', () => {
    const home = read('/');
    const m = home.match(/publications-latest:start([\s\S]*?)publications-latest:end/u);
    assert.ok(m, 'home lacks the publications marker block');
    for (const rec of d.records) assert.ok(m[1].includes(rec.tag) && m[1].includes(rec.zenodo_title), `home block missing ${rec.tag}`);
    assert.ok(home.includes('<a class="more" href="/publications/">'), 'home lacks the full-feed link');
    const nav = home.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/u);
    assert.ok(nav && nav[1].includes('href="/publications/"'), 'home nav misses Publications');
  });
})();
check('no client-side JavaScript or inline handlers anywhere', () => {
  function* htmlFiles(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '.git') continue;
        yield* htmlFiles(path.join(dir, e.name));
      } else if (e.name.endsWith('.html')) yield path.join(dir, e.name);
    }
  }
  for (const f of [...htmlFiles(root)]) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<script\b([^>]*)>/gi)) assert.ok(/type="application\/ld\+json"/i.test(m[1]), `${f}: <script> without JSON-LD type`);
    assert.ok(!/javascript:/i.test(s), `${f}: javascript: URL present`);
    for (const m of s.matchAll(/<[^>]*\s(on[a-z][a-z]*)\s*=/gi)) throw new Error(`${f}: inline event handler (${m[1]})`);
  }
});
if (process.argv.includes('--live')) {
  const all = [...pages, ...assets];
  for (const route of all) {
    const res = await fetch(`${base}${route}`, {redirect:'follow', signal: AbortSignal.timeout(12000)}).catch(e => ({ok:false,status:0,error:e}));
    check(`live ${route}`, () => { assert.equal(res.status,200, `${res.status} ${res.error ?? ''}`); assert.equal(new URL(res.url).host, 'macbrainslabs.org'); });
    if(res.status===200 && pages.includes(route)) {
      const html=await res.text();
      check(`live canonical ${route}`,()=>assert.ok(html.includes(`<link rel="canonical" href="${base}${route}">`)));
      check(`live nav ${route}`,()=>assert.ok(!html.includes('/macbrainslabs-site/')));
    }
  }
}
console.log(`Site verification: ${checks-failures.length}/${checks} passed`);
if(failures.length){ console.error(failures.join('\n')); process.exitCode=1; }
