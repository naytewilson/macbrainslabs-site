#!/usr/bin/env node
// Dependency-free regression check for the custom-domain static research site.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const base = 'https://macbrainslabs.org';
const root = process.cwd();
const pages = ['/', '/research/', '/methods/', '/contact/', '/notes/', '/notes/qwen-lut4/', '/notes/lfm-parity/', '/notes/decode-regimes/', '/evidence/qwen-placement/'];
const assets = ['/styles.css', '/favicon.svg', '/sitemap.xml', '/robots.txt'];
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
check('contact mailto on every page', () => {
  for (const route of pages) assert.ok(read(route).includes('href="mailto:research@macbrainslabs.org"'), `missing on ${route}`);
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
check('CNAME preserved', () => assert.equal(fs.readFileSync('CNAME','utf8').trim(), 'macbrainslabs.org'));
check('robots canonical sitemap', () => assert.ok(read('/robots.txt').includes(`Sitemap: ${base}/sitemap.xml`)));
check('sitemap canonical URLs', () => {
  const xml = read('/sitemap.xml');
  for(const route of pages) assert.ok(xml.includes(`<loc>${base}${route}</loc>`), `missing ${route}`);
  assert.ok(!xml.includes('naytewilson.github.io'));
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
