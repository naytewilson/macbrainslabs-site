#!/usr/bin/env node
// Dependency-free regression check for the custom-domain static research site.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertCenteredBrandIcons } from './assert-brand-icons.mjs';
import { assertReviewedTextContrast } from './check-contrast.mjs';
import { socialPathForRoute } from './social-path.mjs';

const base = 'https://macbrainslabs.org';
const root = process.cwd();
const recordRoutes = (() => {
  const dir = path.join(root, 'research/records');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^ane-record-[0-9a-f]{24}$/u.test(n) && fs.existsSync(path.join(dir, n, 'index.html'))).sort().map(n => `/research/records/${n}/`) : [];
})();
const pages = ['/', '/research/', '/methods/', '/publications/', '/contact/', '/notes/', '/notes/qwen-lut4/', '/notes/lfm-parity/', '/notes/decode-regimes/', '/notes/lfm-chain/', '/notes/graft-costs/', '/evidence/qwen-placement/', '/research/explore/', '/start/', '/security/', '/security/archive-path-traversal/', '/security/evidence-validation/', ...recordRoutes];
const assets = ['/404.html', '/styles.css', '/home.css', '/assets/brand-mark-96.png', '/assets/notch-v13.mp4', '/assets/notch-v13-mobile.mp4', '/assets/notch-first.webp', '/assets/notch-still.webp', '/assets/notch-loop.mp4', '/assets/notch-loop-mobile.mp4', '/assets/notch-img.mp4', '/assets/notch-img-mobile.mp4', '/assets/notch-mobile-manifest.json', '/assets/notch-sway.avif', '/home.js', '/explore.js', '/experience.css', '/research/explore/catalog.json', '/favicon.svg', '/favicon.ico', '/site.webmanifest', '/apple-touch-icon.png', '/assets/icon-16.png', '/assets/icon-32.png', '/assets/icon-48.png', '/assets/icon-192.png', '/assets/icon-512.png', '/assets/social-card.svg', '/assets/social-card.png', '/sitemap.xml', '/robots.txt', '/.well-known/security.txt', '/security/evidence/results.json', '/security/evidence/README.md', '/security/evidence/SHA256SUMS', '/publications/publications.json'];
assets.push(...pages.map(route => socialPathForRoute(route)));
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
  check(`${label} branded browser and iPhone icons`, () => {
    assert.ok(html.includes('<link rel="icon" href="/assets/brand-mark-96.png" type="image/png" sizes="96x96">'));
    assert.ok(html.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">'));
  });
  check(`${label} branded social preview and install metadata`, () => {
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
    const imageURL = base + socialPathForRoute(urlPath);
    assert.ok(html.includes(`<meta property="og:image" content="${imageURL}">`), `incorrect social card: ${urlPath}`);
    assert.ok(html.includes(`<meta name="twitter:image" content="${imageURL}">`));
    assert.ok(html.includes('<meta property="og:image:width" content="1200">'));
    assert.ok(html.includes('<meta property="og:image:height" content="630">'));
    assert.ok(html.includes('<meta property="og:image:alt"'));
    assert.ok(html.includes('<meta property="og:image:alt" content="MacBrains Labs research:') || urlPath === '/', 'social image needs a page-specific description');
    assert.ok(html.includes('<link rel="manifest" href="/site.webmanifest">'));
    for (const size of [16, 32, 48]) {
      assert.ok(html.includes(`href="/assets/icon-${size}.png"`), `missing browser icon ${size}`);
    }
    assert.ok(html.includes('<meta name="apple-mobile-web-app-title" content="MacBrains Labs">'));
  });
  check(`${label} no stale host or project prefix`, () => {
    assert.ok(!html.includes('/macbrainslabs-site/'));
    assert.ok(!html.includes('naytewilson.github.io/macbrainslabs-site'));
  });
}
check('all published pages expose a source-specific card with working image assets', () => {
  for (const route of pages) {
    const file = socialPathForRoute(route);
    const png = fs.readFileSync(fileFor(file));
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a', file);
    assert.equal(png.readUInt32BE(16), 1200, file + ' width');
    assert.equal(png.readUInt32BE(20), 630, file + ' height');
    if (route !== '/') {
      assert.ok(fs.existsSync(fileFor(file.replace(/\\.png$/, '.svg'))), route + ' social SVG source absent');
      assert.ok(read(route).includes('<meta property="og:image:alt" content="MacBrains Labs research:'));
    }
  }
});
check('evidence explorer derives only public records with explicit observation classes', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'research/explore/catalog.json'),'utf8'));
  assert.equal(catalog.schema, 'macbrainslabs.public-evidence-index.v1');
  assert.ok(catalog.generated_from.includes('publications/publications.json'));
  const counts = catalog.items.reduce((m,x)=>(m[x.kind]=(m[x.kind]||0)+1,m),{});
  assert.ok(counts.measured >= 3 && counts.planner >= 3 && counts.note >= 5 && counts.archive >= 2);
  const ids = catalog.items.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of catalog.items) {
    assert.ok(item.title && item.limitation && item.observation && item.url);
    if (item.kind === 'planner') assert.match(item.observation, /MLComputePlan|assigned|placement/i);
    if (item.kind === 'archive') assert.match(item.observation, /integrity: verified/);
  }
  assert.equal((read('/research/explore/').match(/class="evidence-card"/g)||[]).length, ids.length);
});
check('social preview image and full icon set have correct native formats', () => {
  const inspect = (name, w, h) => {
    const data = fs.readFileSync(path.join(root, name));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name);
    assert.equal(data.readUInt32BE(16), w, name + ' width');
    assert.equal(data.readUInt32BE(20), h, name + ' height');
    return data;
  };
  for (const size of [16, 32, 48, 192, 512]) inspect(`assets/icon-${size}.png`, size, size);
  const card = inspect('assets/social-card.png', 1200, 630);
  assert.ok(card.length < 250_000, 'large preview should stay under 250 kB');
  assert.ok(read('/404.html').includes('<link rel="manifest" href="/site.webmanifest">'));
  const ico = fs.readFileSync(path.join(root, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const recordTemplate = fs.readFileSync(path.join(root, 'scripts/gen-record-page.mjs'), 'utf8');
  const publicationsTemplate = fs.readFileSync(path.join(root, 'scripts/update-publications.mjs'), 'utf8');
  assert.ok(recordTemplate.includes('socialPathForRoute(ROUTE)'), 'diagnostic generator must use its own social URL');
  assert.ok(publicationsTemplate.includes('https://macbrainslabs.org/assets/social/publications.png'), 'publication feed must retain its own social URL');
  for (const tpl of [recordTemplate, publicationsTemplate]) assert.ok(tpl.includes('<link rel="manifest" href="/site.webmanifest">'));
});
check('installable manifest is scoped, icon-complete, and has no service worker requirement', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'MacBrains Labs');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.ok(icon.purpose.includes('maskable') && icon.purpose.includes('any'));
    assert.equal(icon.type, 'image/png');
    assert.ok(fs.existsSync(fileFor(icon.src)));
  }
});
check('iPhone Home Screen icon exists as a 180x180 PNG with app label', () => {
  const png = fs.readFileSync(path.join(root, 'apple-touch-icon.png'));
  assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.ok(read('/').includes('<meta name="apple-mobile-web-app-title" content="MacBrains Labs">'));
});
check('approved MB brand icons are visually centered and background-safe', () => assertCenteredBrandIcons(root));
check('reviewed body text and metadata colors meet AA normal-text contrast', () => assertReviewedTextContrast(root));
check('research JSON-LD parses and names DOI and ORCID', () => {
  const m = read('/research/').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'no JSON-LD block');
  const d = JSON.parse(m[1]);
  assert.equal(d['@type'], 'Dataset');
  assert.equal(d.identifier, 'https://doi.org/10.5281/zenodo.23798037');
  assert.equal(d.isPartOf && d.isPartOf.identifier, 'https://doi.org/10.5281/zenodo.23798036', 'research JSON-LD must link the all-versions DOI');
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
check('mobile Notch encodes preserve source identities, full-range color and >50% transfer savings', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root,'assets/notch-mobile-manifest.json'),'utf8'));
  assert.equal(data.schema, 'macbrainslabs.notch.mobile.v1');
  assert.equal(data.mobile_video.width,720);
  assert.equal(data.mobile_video.height,1008);
  assert.equal(data.mobile_video.fps,24);
  assert.equal(data.full_range_color.range,'pc');
  assert.equal(data.full_range_color.transfer,'iec61966-2-1');
  assert.equal(data.pairs.length,3);
  for (const pair of data.pairs) {
    for (const kind of ['source','mobile']) {
      const raw=fs.readFileSync(path.join(root,'assets',pair[kind].name));
      assert.equal(raw.length,pair[kind].size_bytes,pair[kind].name);
      assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),pair[kind].sha256,pair[kind].name);
    }
    assert.ok(pair.saving_percent>50 && pair.ssim_all>.98);
  }
  assert.ok(read('/').includes('<source src="/assets/notch-v13-mobile.mp4" type="video/mp4" media="(max-width: 700px)">'));
  const script=read('/home.js');
  assert.ok(script.includes("'/assets/notch-loop-mobile.mp4'") && script.includes("'/assets/notch-img-mobile.mp4'"));
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
    for (const attr of ['muted', 'playsinline']) assert.ok(new RegExp('\\s' + attr + '\\b').test(a), `video needs ${attr}`);
    assert.ok(/\spreload="none"/.test(a) && !/\sautoplay\b/.test(a), 'video must defer playback and avoid eager reduced-motion downloads');
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
  // The home figure shows the shipped build (the June result stays in the evidence bundle and on /research/).
  const shipped = prov.rerun_2026_10_30.result;
  assert.ok(read('/').includes(`data-ane="${shipped.ANE}" data-cpu="${shipped.CPU}"`), 'home figure disagrees with the shipped-build rerun in provenance.json');
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
const pubEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pubUrl = (u, what) => {
  let p;
  try { p = new URL(u); } catch { throw new Error(`${what}: unparseable URL`); }
  assert.equal(p.protocol, 'https:', `${what}: not https`);
  assert.ok(PUB_LINK_HOSTS.includes(p.host), `${what}: ${p.host} outside the link allowlist`);
  assert.ok(!p.username && !p.password, `${what}: userinfo in URL`);
};

const pubs = (() => {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'publications/publications.json'), 'utf8'));
  // vX.Y.Z archive releases carry no kind; reviewed research records carry kind "ane-record".
  const legacy = (d.records ?? []).filter(r => r.kind === undefined);
  const ane = (d.records ?? []).filter(r => r.kind === 'ane-record');
  const diag = (d.records ?? []).filter(r => r.kind === 'ane-diagnostic');
  const pkg = (d.records ?? []).filter(r => r.kind === 'ane-package');
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
      assert.ok(rec.kind === undefined || rec.kind === 'ane-record' || rec.kind === 'ane-diagnostic' || rec.kind === 'ane-package', `${rec.tag}: unknown record kind`);
      if (rec.kind === 'ane-record' || rec.kind === 'ane-diagnostic' || rec.kind === 'ane-package') {
        assert.match(rec.tag, /^ane-record-[0-9a-f]{24}$/u, `bad tag ${rec.tag}`);
        pubClean(rec.release_name, `${rec.tag} release_name`, 300);
        pubClean(rec.title, `${rec.tag} title`, 300);
        assert.match(rec.version, /^v[0-9]+\.[0-9]+\.[0-9]+$/u, `${rec.tag}: version`);
      } else {
        assert.match(rec.tag, /^v[0-9]+\.[0-9]+\.[0-9]+$/u, `bad tag ${rec.tag}`);
        pubClean(rec.release_name, `${rec.tag} release_name`, 300);
        pubClean(rec.record_class, `${rec.tag} record_class`, 200);
        pubClean(rec.zenodo_title, `${rec.tag} zenodo_title`, 300);
      }
      assert.match(rec.published_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u, `${rec.tag}: published_at not ISO-UTC`);
      assert.ok(rec.published_at.slice(0, 10) >= '2026-01-01', `${rec.tag}: implausibly old record`);
    }
  });
  check('publications feed provenance is exact and re-checkable', () => {
    for (const rec of legacy) {
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
    for (const rec of legacy) {
      const doi = rec.doi;
      pubClean(doi.tagged_manifest_doi_status, `${rec.tag} tagged_manifest_doi_status`, 300);
      assert.ok(!('doi_status' in doi), `${rec.tag}: stale doi_status key must not exist`);
      assert.ok(['manifest at the tag', 'citation file at main', 'records index at main', 'not issued'].includes(doi.binding_source), `${rec.tag}: binding_source`);
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
        if (doi.binding_source === 'citation file at main' || doi.binding_source === 'records index at main') {
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
    for (const rec of legacy) {
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
    for (const rec of legacy) {
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
  check('publications feed reviewed research records are bound, labelled and verified', () => {
    const SHA = /^[a-f0-9]{64}$/u;
    for (const rec of ane) {
      assert.equal(rec.release_url, `https://github.com/macbrainslabs/ane-research-records/releases/tag/${rec.tag}`, `${rec.tag}: release_url`);
      assert.equal(rec.record_url, `${base}/research/records/${rec.tag}/`, `${rec.tag}: record_url is not this record's page`);
      pubUrl(rec.record_url, `${rec.tag} record_url`);
      assert.match(rec.released_on, /^\d{4}-\d\d-\d\d$/u, `${rec.tag}: released_on`);
      const r = rec.replication;
      assert.ok(['same-chip', 'cross-device'].includes(r.scope), `${rec.tag}: replication scope`);
      assert.equal(r.cross_device_replication, r.scope === 'cross-device', `${rec.tag}: a same-chip rerun must never count as cross-device replication`);
      pubClean(r.claim, `${rec.tag} replication claim`, 300);
      assert.match(r.profile_hash, SHA, `${rec.tag}: setup profile hash`);
      for (const k of ['run_count', 'pass_count', 'fail_count']) assert.ok(Number.isSafeInteger(r[k]) && r[k] >= 0, `${rec.tag}: ${k}`);
      assert.ok(r.run_count >= 1 && r.pass_count + r.fail_count === r.run_count, `${rec.tag}: runs kept do not add up`);
      assert.match(rec.review.review_package_hash, SHA, `${rec.tag}: review package hash`);
      assert.match(rec.review.verdict_digest, SHA, `${rec.tag}: verdict digest`);
      assert.equal(rec.review.reviewer, 'macbrains-labs-reviewer', `${rec.tag}: reviewer`);
      assert.deepEqual(rec.assets.map(a => a.name), ['finding.json', 'citations.json', 'preview.md', 'manifest.json'], `${rec.tag}: asset set`);
      for (const a of rec.assets) {
        assert.ok(Number.isInteger(a.size) && a.size > 0, `${rec.tag}: asset size`);
        assert.match(a.digest, /^sha256:[a-f0-9]{64}$/u, `${rec.tag}: asset registered digest`);
        pubUrl(a.url, `${rec.tag} asset url`);
        assert.ok(a.sha256 === null || SHA.test(a.sha256), `${rec.tag}: asset verified digest`);
      }
      const doi = rec.doi;
      assert.equal(doi.concept_doi, '10.5281/zenodo.23798036', `${rec.tag}: all-versions DOI`);
      const st = doi.crosscheck.state;
      assert.ok(['pass', 'mismatch', 'unreachable', 'not_minted'].includes(st), `${rec.tag}: crosscheck state`);
      assert.equal(doi.registered_state, { pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now', not_minted: 'not_minted' }[st], `${rec.tag}: registered_state must follow the crosscheck`);
      assert.ok(['verified', 'degraded'].includes(rec.verification.state), `${rec.tag}: verification state`);
      assert.ok(Array.isArray(rec.verification.guards) && rec.verification.guards.length >= 2, `${rec.tag}: guards`);
      for (const g of rec.verification.guards) {
        pubClean(g.name, `${rec.tag} guard name`, 200);
        assert.ok(['pass', 'degraded'].includes(g.state), `${rec.tag}: guard state`);
      }
      const guardDegraded = rec.verification.guards.some(g => g.state !== 'pass');
      if (rec.verification.state === 'verified') {
        assert.ok(!guardDegraded, `${rec.tag}: shown verified while a guard is degraded`);
        assert.equal(rec.review.decision, 'INCLUDE', `${rec.tag}: shown verified without an INCLUDE verdict`);
        assert.equal(st, 'pass', `${rec.tag}: shown verified without a passing Zenodo binding`);
        assert.match(doi.version_doi, /^10\.5281\/zenodo\.\d+$/u, `${rec.tag}: version_doi`);
        assert.notEqual(doi.version_doi, doi.concept_doi, `${rec.tag}: version DOI equals the all-versions DOI`);
        assert.equal(doi.zenodo_record_url, `https://zenodo.org/records/${doi.version_doi.split('.').at(-1)}`, `${rec.tag}: record URL does not match the version DOI`);
        for (const a of rec.assets) assert.equal(a.sha256, a.digest.slice('sha256:'.length), `${rec.tag}: verified record with unverified asset digest`);
      } else {
        assert.ok(guardDegraded, `${rec.tag}: degraded with no degraded guard`);
      }
    }
  });
  check('publications feed diagnostic research records are bound, labelled and verified', () => {
    const SHA = /^[a-f0-9]{64}$/u;
    for (const rec of diag) {
      assert.equal(rec.release_url, `https://github.com/macbrainslabs/ane-research-records/releases/tag/${rec.tag}`, `${rec.tag}: release_url`);
      assert.equal(rec.record_url, `${base}/research/records/${rec.tag}/`, `${rec.tag}: record_url is not this record's page`);
      pubUrl(rec.record_url, `${rec.tag} record_url`);
      assert.ok(fs.existsSync(fileFor(`/research/records/${rec.tag}/`)), `${rec.tag}: record page missing`);
      assert.match(rec.released_on, /^\d{4}-\d\d-\d\d$/u, `${rec.tag}: released_on`);
      assert.match(rec.finding_id, /^finding:[0-9a-f]{40}$/u, `${rec.tag}: finding id`);
      assert.match(rec.bundle_sha256, SHA, `${rec.tag}: bundle hash`);
      assert.match(rec.attestation_sha256, SHA, `${rec.tag}: attestation hash`);
      const r = rec.replication;
      assert.ok(['same-chip', 'cross-device'].includes(r.scope), `${rec.tag}: replication scope`);
      assert.equal(r.cross_device_replication, r.scope === 'cross-device', `${rec.tag}: a same-chip rerun must never count as cross-device replication`);
      pubClean(r.claim, `${rec.tag} replication claim`, 300);
      if (r.scope === 'same-chip') assert.ok(r.claim.startsWith('same-chip'), `${rec.tag}: a same-chip record's scope must say same-chip first`);
      assert.match(r.profile_hash, SHA, `${rec.tag}: setup profile hash`);
      for (const k of ['logged', 'counted', 'pre_freeze', 'deleted']) assert.ok(Number.isSafeInteger(r[k]) && r[k] >= 0, `${rec.tag}: ${k}`);
      assert.ok(r.logged >= 1 && r.counted + r.pre_freeze === r.logged && r.deleted <= r.counted, `${rec.tag}: execution counts do not add up`);
      assert.match(rec.review.reviewed_package_sha256, SHA, `${rec.tag}: reviewed package hash`);
      assert.equal(rec.review.reviewer, 'macbrains-labs-reviewer', `${rec.tag}: reviewer`);
      assert.ok(['INCLUDE', 'HOLD', 'unknown'].includes(rec.review.decision), `${rec.tag}: decision`);
      assert.ok(rec.review.verdict_receipt_sha256 === null || SHA.test(rec.review.verdict_receipt_sha256), `${rec.tag}: verdict receipt`);
      assert.ok(Array.isArray(rec.review.pipeline), `${rec.tag}: pipeline reviews`);
      for (const p of rec.review.pipeline) {
        assert.ok(['evidence_reviewer', 'skeptical_reviewer'].includes(p.role) && ['INCLUDE', 'HOLD'].includes(p.verdict), `${rec.tag}: pipeline review entry`);
        pubClean(p.model, `${rec.tag} pipeline model`, 120);
      }
      assert.deepEqual(rec.assets.map(a => a.name), ['bundle.json', 'attestation.json', 'execution-log.jsonl', 'deletion-disclosure.md', 'preview.md', 'SHA256SUMS'], `${rec.tag}: asset set`);
      for (const a of rec.assets) {
        assert.ok(Number.isInteger(a.size) && a.size > 0, `${rec.tag}: asset size`);
        assert.match(a.digest, /^sha256:[a-f0-9]{64}$/u, `${rec.tag}: asset registered digest`);
        pubUrl(a.url, `${rec.tag} asset url`);
        assert.ok(a.sha256 === null || SHA.test(a.sha256), `${rec.tag}: asset verified digest`);
      }
      const doi = rec.doi;
      assert.equal(doi.concept_doi, '10.5281/zenodo.23798036', `${rec.tag}: all-versions DOI`);
      const st = doi.crosscheck.state;
      assert.ok(['pass', 'mismatch', 'unreachable', 'not_minted'].includes(st), `${rec.tag}: crosscheck state`);
      assert.equal(doi.registered_state, { pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now', not_minted: 'not_minted' }[st], `${rec.tag}: registered_state must follow the crosscheck`);
      assert.ok(['verified', 'degraded'].includes(rec.verification.state), `${rec.tag}: verification state`);
      assert.ok(Array.isArray(rec.verification.guards) && rec.verification.guards.length >= 2, `${rec.tag}: guards`);
      for (const g of rec.verification.guards) {
        pubClean(g.name, `${rec.tag} guard name`, 200);
        assert.ok(['pass', 'degraded'].includes(g.state), `${rec.tag}: guard state`);
      }
      const guardDegraded = rec.verification.guards.some(g => g.state !== 'pass');
      if (rec.verification.state === 'verified') {
        assert.ok(!guardDegraded, `${rec.tag}: shown verified while a guard is degraded`);
        assert.equal(rec.review.decision, 'INCLUDE', `${rec.tag}: shown verified without an INCLUDE verdict`);
        assert.ok(rec.review.pipeline.length === 2 && rec.review.pipeline.every(p => p.verdict === 'INCLUDE'), `${rec.tag}: shown verified without two INCLUDE pipeline reviews`);
        assert.equal(st, 'pass', `${rec.tag}: shown verified without a passing Zenodo binding`);
        assert.match(doi.version_doi, /^10\.5281\/zenodo\.\d+$/u, `${rec.tag}: version_doi`);
        assert.notEqual(doi.version_doi, doi.concept_doi, `${rec.tag}: version DOI equals the all-versions DOI`);
        assert.equal(doi.zenodo_record_url, `https://zenodo.org/records/${doi.version_doi.split('.').at(-1)}`, `${rec.tag}: record URL does not match the version DOI`);
        for (const a of rec.assets) assert.equal(a.sha256, a.digest.slice('sha256:'.length), `${rec.tag}: verified record with unverified asset digest`);
      } else {
        assert.ok(guardDegraded, `${rec.tag}: degraded with no degraded guard`);
      }
    }
  });
  check('publications feed package research records are bound, labelled and verified', () => {
    const SHA = /^[a-f0-9]{64}$/u;
    for (const rec of pkg) {
      assert.equal(rec.release_url, `https://github.com/macbrainslabs/ane-research-records/releases/tag/${rec.tag}`, `${rec.tag}: release_url`);
      assert.equal(rec.record_url, `${base}/research/records/${rec.tag}/`, `${rec.tag}: record_url is not this record's page`);
      pubUrl(rec.record_url, `${rec.tag} record_url`);
      assert.ok(fs.existsSync(fileFor(`/research/records/${rec.tag}/`)), `${rec.tag}: record page missing`);
      assert.match(rec.released_on, /^\d{4}-\d\d-\d\d$/u, `${rec.tag}: released_on`);
      for (const k of ['attestation_sha256', 'record_sha256', 'files_list_sha256']) assert.match(rec[k], SHA, `${rec.tag}: ${k}`);
      const r = rec.replication;
      assert.ok(['same-chip', 'cross-device'].includes(r.scope), `${rec.tag}: replication scope`);
      assert.equal(r.cross_device_replication, r.scope === 'cross-device', `${rec.tag}: a same-chip rerun must never count as cross-device replication`);
      pubClean(r.claim, `${rec.tag} replication claim`, 300);
      if (r.scope === 'same-chip') assert.ok(r.claim.startsWith('same-chip'), `${rec.tag}: a same-chip record's scope must say same-chip first`);
      assert.ok(Array.isArray(r.profile_hashes) && r.profile_hashes.length >= 1 && r.profile_hashes.every(h => SHA.test(h)), `${rec.tag}: setup profile hashes`);
      for (const k of ['counted', 'passed', 'failed']) assert.ok(Number.isSafeInteger(r[k]) && r[k] >= 0, `${rec.tag}: ${k}`);
      assert.ok(r.counted >= 1 && r.passed + r.failed === r.counted, `${rec.tag}: run counts do not add up`);
      assert.ok(Array.isArray(r.arms), `${rec.tag}: arms`);
      for (const a of r.arms) { pubClean(a.arm, `${rec.tag} arm`, 40); assert.ok(r.profile_hashes.includes(a.profile_hash) && Number.isSafeInteger(a.counted) && Number.isSafeInteger(a.passed), `${rec.tag}: arm entry`); }
      assert.match(rec.review.reviewed_package_sha256, SHA, `${rec.tag}: reviewed package hash`);
      assert.equal(rec.review.reviewer, 'macbrains-labs-reviewer', `${rec.tag}: reviewer`);
      assert.ok(['INCLUDE', 'HOLD', 'unknown'].includes(rec.review.decision), `${rec.tag}: decision`);
      assert.ok(rec.review.verdict_receipt_sha256 === null || SHA.test(rec.review.verdict_receipt_sha256), `${rec.tag}: verdict receipt`);
      assert.equal(rec.assets.length, 5, `${rec.tag}: asset count`);
      assert.deepEqual([rec.assets[0].name, rec.assets[1].name, rec.assets[4].name], ['attestation.json', 'preview.md', 'SHA256SUMS'], `${rec.tag}: asset set`);
      for (const a of rec.assets) {
        assert.ok(Number.isInteger(a.size) && a.size > 0, `${rec.tag}: asset size`);
        assert.match(a.digest, /^sha256:[a-f0-9]{64}$/u, `${rec.tag}: asset registered digest`);
        pubUrl(a.url, `${rec.tag} asset url`);
        assert.ok(a.sha256 === null || SHA.test(a.sha256), `${rec.tag}: asset verified digest`);
      }
      const doi = rec.doi;
      assert.equal(doi.concept_doi, '10.5281/zenodo.23798036', `${rec.tag}: all-versions DOI`);
      const st = doi.crosscheck.state;
      assert.ok(['pass', 'mismatch', 'unreachable', 'not_minted'].includes(st), `${rec.tag}: crosscheck state`);
      assert.equal(doi.registered_state, { pass: 'registered_verified', mismatch: 'mismatch_detected', unreachable: 'unverifiable_now', not_minted: 'not_minted' }[st], `${rec.tag}: registered_state must follow the crosscheck`);
      assert.ok(['verified', 'degraded'].includes(rec.verification.state), `${rec.tag}: verification state`);
      for (const g of rec.verification.guards) { pubClean(g.name, `${rec.tag} guard name`, 200); assert.ok(['pass', 'degraded'].includes(g.state), `${rec.tag}: guard state`); }
      const guardDegraded = rec.verification.guards.some(g => g.state !== 'pass');
      if (rec.verification.state === 'verified') {
        assert.ok(!guardDegraded, `${rec.tag}: shown verified while a guard is degraded`);
        assert.equal(rec.review.decision, 'INCLUDE', `${rec.tag}: shown verified without an INCLUDE verdict`);
        assert.equal(r.arms.length, r.profile_hashes.length, `${rec.tag}: shown verified without every arm recounted`);
        assert.equal(st, 'pass', `${rec.tag}: shown verified without a passing Zenodo binding`);
        assert.match(doi.version_doi, /^10\.5281\/zenodo\.\d+$/u, `${rec.tag}: version_doi`);
        assert.notEqual(doi.version_doi, doi.concept_doi, `${rec.tag}: version DOI equals the all-versions DOI`);
        assert.equal(doi.zenodo_record_url, `https://zenodo.org/records/${doi.version_doi.split('.').at(-1)}`, `${rec.tag}: record URL does not match the version DOI`);
        for (const a of rec.assets) assert.equal(a.sha256, a.digest.slice('sha256:'.length), `${rec.tag}: verified record with unverified asset digest`);
      } else {
        assert.ok(guardDegraded, `${rec.tag}: degraded with no degraded guard`);
      }
    }
  });
  const feedHtml = read('/publications/');
  check('publications page renders exactly the feed records', () => {
    for (const rec of d.records) assert.ok(feedHtml.includes(`data-tag="${rec.tag}"`), `${rec.tag} not rendered on the publications page`);
    assert.ok(feedHtml.includes(`data-generated="${d.generated_at}"`), 'feed page does not carry the feed generation stamp');
    assert.ok(feedHtml.includes(`data-state="${d.upstream_status}"`), 'feed page does not carry the upstream status');
    for (const rec of d.records) {
      for (const p of rec.provenance?.source_pages ?? []) {
        if (p.fingerprint_check === 'match') assert.ok(feedHtml.includes(p.sha256), `${rec.tag}: fingerprint ${p.sha256.slice(0, 12)} not shown on the page`);
      }
      for (const a of rec.assets) {
        if (a.sha256) assert.ok(feedHtml.includes(a.sha256), `${rec.tag}: asset digest not shown`);
      }
    }
  });
  check('publications page shows each reviewed research record with its bindings and scope label', () => {
    for (const rec of ane) {
      const at = feedHtml.indexOf(`data-tag="${rec.tag}"`);
      assert.ok(at !== -1, `${rec.tag} not rendered`);
      const art = feedHtml.slice(at, feedHtml.indexOf('</article>', at));
      const r = rec.replication;
      for (const s of [pubEsc(rec.version), pubEsc(rec.title), pubEsc(r.claim), r.profile_hash, rec.review.review_package_hash, rec.review.verdict_digest, `href="${rec.record_url}"`]) {
        assert.ok(art.includes(s), `${rec.tag}: ${s.slice(0, 32)} not shown`);
      }
      assert.ok(art.includes(`${r.run_count} runs kept: ${r.pass_count} pass, ${r.fail_count} fail`), `${rec.tag}: runs kept not shown`);
      if (r.scope === 'same-chip') assert.ok(art.includes('not cross-device replication'), `${rec.tag}: same-chip rerun lacks its scope label`);
      for (const a of rec.assets) if (a.sha256) assert.ok(art.includes(a.sha256), `${rec.tag}: asset digest not shown`);
      if (rec.verification.state === 'verified') assert.ok(art.includes(`href="https://doi.org/${rec.doi.version_doi}"`), `${rec.tag}: verified version DOI not shown`);
    }
  });
  check('publications page shows each diagnostic research record with its bindings, run accounting and scope label', () => {
    for (const rec of diag) {
      const at = feedHtml.indexOf(`data-tag="${rec.tag}"`);
      assert.ok(at !== -1, `${rec.tag} not rendered`);
      const art = feedHtml.slice(at, feedHtml.indexOf('</article>', at));
      const r = rec.replication;
      for (const s of [pubEsc(rec.version), pubEsc(rec.title), pubEsc(r.claim), r.profile_hash, rec.review.reviewed_package_sha256, rec.bundle_sha256, rec.attestation_sha256, `href="${rec.record_url}"`]) {
        assert.ok(art.includes(s), `${rec.tag}: ${s.slice(0, 32)} not shown`);
      }
      assert.ok(art.includes(`${r.logged} executions logged and disclosed: ${r.counted} after the setup profile froze, ${r.pre_freeze} before it`), `${rec.tag}: run accounting not shown`);
      if (r.scope === 'same-chip') assert.ok(art.includes('not cross-device replication'), `${rec.tag}: same-chip record lacks its scope label`);
      for (const a of rec.assets) if (a.sha256) assert.ok(art.includes(a.sha256), `${rec.tag}: asset digest not shown`);
      if (rec.verification.state === 'verified') assert.ok(art.includes(`href="https://doi.org/${rec.doi.version_doi}"`), `${rec.tag}: verified version DOI not shown`);
    }
  });
  check('publications page shows each package research record with its bindings, run accounting and scope label', () => {
    for (const rec of pkg) {
      const at = feedHtml.indexOf(`data-tag="${rec.tag}"`);
      assert.ok(at !== -1, `${rec.tag} not rendered`);
      const art = feedHtml.slice(at, feedHtml.indexOf('</article>', at));
      const r = rec.replication;
      for (const s of [pubEsc(rec.version), pubEsc(rec.title), pubEsc(r.claim), ...r.profile_hashes, rec.review.reviewed_package_sha256, rec.record_sha256, rec.attestation_sha256, `href="${rec.record_url}"`]) {
        assert.ok(art.includes(s), `${rec.tag}: ${s.slice(0, 32)} not shown`);
      }
      assert.ok(art.includes(`${r.counted} counted runs kept across ${r.profile_hashes.length} clean-room arm`), `${rec.tag}: run accounting not shown`);
      if (r.scope === 'same-chip') assert.ok(art.includes('not cross-device replication'), `${rec.tag}: same-chip record lacks its scope label`);
      for (const a of rec.assets) if (a.sha256) assert.ok(art.includes(a.sha256), `${rec.tag}: asset digest not shown`);
      if (rec.verification.state === 'verified') assert.ok(art.includes(`href="https://doi.org/${rec.doi.version_doi}"`), `${rec.tag}: verified version DOI not shown`);
    }
  });
  check('research record pages state their scope and bind to the feed', () => {
    for (const route of recordRoutes) {
      const tag = route.split('/')[3];
      const html = read(route);
      const pkgPage = html.includes('data-record-kind="package"');
      for (const s of ['not cross-device replication', 'no novelty claim', `data-tag="${tag}"`, `href="https://github.com/macbrainslabs/ane-research-records/releases/tag/${tag}"`]) {
        assert.ok(html.includes(s), `${route}: missing ${s}`);
      }
      // A package record states ANE execution as NOT CLAIMED or INFERRED; a diagnostic record as INFERRED.
      assert.ok(html.includes('ANE execution INFERRED') || (pkgPage && html.includes('ANE execution NOT CLAIMED')), `${route}: ANE execution label missing`);
      assert.ok(read('/sitemap.xml').includes(`<loc>${base}${route}</loc>`), `${route}: not in the sitemap`);
      const rec = d.records.find(x => x.tag === tag);
      if (!rec) continue;
      assert.equal(rec.record_url, `${base}${route}`, `${route}: feed record_url is not this page`);
      const r = rec.replication;
      const must = rec.kind === 'ane-package' ? [pubEsc(rec.title), pubEsc(r.claim), ...r.profile_hashes, rec.attestation_sha256, rec.record_sha256, rec.review.reviewed_package_sha256, `${r.counted} counted runs`] : [pubEsc(rec.title), pubEsc(r.claim), r.profile_hash];
      assert.equal(pkgPage, rec.kind === 'ane-package', `${route}: page kind does not match the feed record kind`);
      if (rec.kind === 'ane-diagnostic') must.push(rec.bundle_sha256, rec.attestation_sha256, rec.review.reviewed_package_sha256, `${r.logged} logged executions`);
      for (const s of must) assert.ok(html.includes(s), `${route}: ${s.slice(0, 32)} from the feed not shown on the record page`);
      if (rec.verification.state === 'verified') assert.ok(html.includes(`href="https://doi.org/${rec.doi.version_doi}"`), `${route}: verified version DOI not shown on the record page`);
    }
  });
  check('home publications block is bound to the feed', () => {
    const home = read('/');
    const m = home.match(/publications-latest:start([\s\S]*?)publications-latest:end/u);
    assert.ok(m, 'home lacks the publications marker block');
    for (const rec of legacy) assert.ok(m[1].includes(rec.tag) && m[1].includes(rec.zenodo_title), `home block missing ${rec.tag}`);
    for (const rec of [...ane, ...diag, ...pkg]) {
      assert.ok(m[1].includes(`href="${rec.record_url}"`) && m[1].includes(pubEsc(rec.version)) && m[1].includes(pubEsc(rec.title)), `home block missing ${rec.tag}`);
      if (rec.replication.scope === 'same-chip') assert.ok(m[1].includes('not cross-device replication'), `home block: ${rec.tag} same-chip rerun lacks its scope label`);
    }
    assert.ok(home.includes('<a class="more" href="/publications/">'), 'home lacks the full-feed link');
    const nav = home.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/u);
    assert.ok(nav && nav[1].includes('href="/publications/"'), 'home nav misses Publications');
  });
})();
check('only the home and evidence explorer load scoped deferred local scripts, never inline JavaScript or handlers', () => {
  function* htmlFiles(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        // Nonpublished development dependencies may contain their own HTML.
        // Inspect public site HTML only, not packages installed for build-time QA.
        if (e.name === '.git' || e.name === 'node_modules') continue;
        yield* htmlFiles(path.join(dir, e.name));
      } else if (e.name.endsWith('.html')) yield path.join(dir, e.name);
    }
  }
  for (const f of [...htmlFiles(root)]) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<script\b([^>]*)>/gi)) assert.ok(/type="application\/ld\+json"/i.test(m[1]) || ((path.relative(root, f) === 'index.html' && m[1].trim() === 'src="/home.js" defer') || (path.relative(root, f) === 'research/explore/index.html' && m[1].trim() === 'src="/explore.js" defer')), `${f}: <script> must be JSON-LD or an approved scoped deferred script`);
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
