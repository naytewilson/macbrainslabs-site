#!/usr/bin/env node
// Dependency-free regression check for the custom-domain static research site.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = 'https://macbrainslabs.org';
const root = process.cwd();
const pages = ['/', '/research/', '/methods/', '/contact/', '/notes/qwen-lut4/', '/notes/lfm-parity/', '/notes/decode-regimes/'];
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
