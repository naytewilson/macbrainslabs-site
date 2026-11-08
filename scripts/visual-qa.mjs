#!/usr/bin/env node
// Static-site visual regression, responsive and accessibility smoke tests.
// Prerequisite (development/CI only): agent-browser 0.41.0 with its Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const update = process.argv.includes('--update');
const baselines = path.join(root, 'tests/visual/baselines');
const current = path.join(root, 'tests/visual/current');
const diffs = path.join(root, 'tests/visual/diffs');
for (const p of [baselines, current, diffs]) fs.mkdirSync(p, { recursive: true });
const session = `macbrains-visual-${process.pid}`;
const served = [];
const mimes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (!(target === root || target.startsWith(root + path.sep))) { res.writeHead(403).end(); return; }
  let stat;
  try { stat = fs.statSync(target); if (!stat.isFile()) throw Error('not file'); }
  catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  served.push({ pathname, range: req.headers.range || null });
  const headers = {
    'Content-Type': mimes[path.extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes'
  };
  let start = 0, end = stat.size - 1, status = 200;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  createReadStream(target, { start, end }).pipe(res);
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function browser(...parts) {
  const { stdout } = await exec('agent-browser', ['--json', '--session', session, ...parts], {
    cwd: root,
    maxBuffer: 6 * 1024 * 1024,
    timeout: 35_000
  });
  const result = JSON.parse(stdout.trim());
  if (!result.success) throw Error(`agent-browser ${parts.slice(0, 3).join(' ')}: ${JSON.stringify(result.error)}`);
  return result.data ?? {};
}

const metricsJS = `(() => {
  const main = document.querySelector('#main');
  const nav = document.querySelector('nav[aria-label="Main navigation"]');
  const anchors = [...(nav?.querySelectorAll('a') ?? [])];
  const boxes = anchors.map(a => {
    const r = a.getBoundingClientRect();
    return { text: a.textContent.trim(), width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 };
  });
  const mediaRequests = performance.getEntriesByType('resource')
    .filter(e => /\\.mp4(?:$|\\?)/.test(e.name))
    .map(e => new URL(e.name).pathname);
  return {
    route: location.pathname,
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    h1Count: document.querySelectorAll('h1').length,
    mainExists: !!main,
    skipExists: !!document.querySelector('a.skip[href="#main"]'),
    navLinks: boxes,
    missingImageAlt: document.querySelectorAll('img:not([alt])').length,
    unnamedLinks: [...document.querySelectorAll('a')].filter(a =>
      !((a.getAttribute('aria-label') || a.textContent || a.querySelector('img')?.getAttribute('alt') || '').trim())).length,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    mediaRequests,
    video: [...document.querySelectorAll('video')].map(v => ({
      autoplay: v.autoplay, preload: v.preload, paused: v.paused
    }))
  };
})()`;

const cases = [
  { id: '01-home-mobile-390', route: '/', w: 390, h: 844 },
  { id: '02-home-folio-mobile-390', route: '/', w: 390, h: 844, selector: '#placement' },
  { id: '03-home-tablet-768', route: '/', w: 768, h: 1024 },
  { id: '04-home-desktop-1440', route: '/', w: 1440, h: 900 },
  { id: '05-research-mobile-390', route: '/research/', w: 390, h: 844 },
  { id: '06-methods-mobile-390', route: '/methods/', w: 390, h: 844 },
  { id: '07-notes-mobile-390', route: '/notes/', w: 390, h: 844 },
  { id: '08-home-small-320', route: '/', w: 320, h: 740 },
  { id: '09-research-light-mobile-390', route: '/research/', w: 390, h: 844, scheme: 'light' },
  { id: '10-research-dark-desktop-1440', route: '/research/', w: 1440, h: 900 },
  { id: '11-methods-light-desktop-1440', route: '/methods/', w: 1440, h: 900, scheme: 'light' },
  { id: '12-research-small-320', route: '/research/', w: 320, h: 740 },
  { id: '13-explorer-mobile-390', route: '/research/explore/', w: 390, h: 844 },
  { id: '14-explorer-desktop-1440', route: '/research/explore/', w: 1440, h: 900 },
  { id: '15-start-mobile-390', route: '/start/', w: 390, h: 844 },
  { id: '16-start-desktop-1440', route: '/start/', w: 1440, h: 900 },
  { id: '17-explorer-filtered-390', route: '/research/explore/', w: 390, h: 844, selector: '#evidence-list', filter: { q: 'LFM', kind: 'note' } }
];

async function run() {
  const base = await listen();
  const results = [];
  const pixelFailures = [];
  try {
    await browser('set', 'media', 'dark', 'reduced-motion');
    for (const c of cases) {
      await browser('set', 'viewport', String(c.w), String(c.h));
      await browser('set', 'media', c.scheme || 'dark', 'reduced-motion');
      const begin = served.length;
      await browser('open', base + c.route);
      await browser('wait', '150');
      if (c.filter) {
        await browser('fill', '#evidence-query', c.filter.q);
        await browser('select', '#evidence-filter', c.filter.kind);
        const { result: filtered } = await browser('eval', "({visible:[...document.querySelectorAll('#evidence-list .evidence-card')].filter(x=>!x.hidden).map(x=>({title:x.querySelector('h3')?.textContent,kind:x.dataset.kind,search:x.dataset.search})),shown:document.querySelector('#evidence-count')?.textContent,search:new URLSearchParams(location.search).get('q'),kind:new URLSearchParams(location.search).get('kind')})");
        assert.ok(filtered.visible.length>=1 && filtered.visible.length<=5, 'filtered result count unexpectedly changed');
        assert.ok(filtered.visible.every(x => x.kind === 'note' && x.search.includes('lfm')), 'LFM note filter returned an unrelated result');
        assert.equal(filtered.search,'lfm');
        assert.equal(filtered.kind,'note');
        assert.match(filtered.shown,/public entr/);
      }
      const { result: m } = await browser('eval', metricsJS);
      assert.equal(m.width, c.w, c.id + ' effective viewport');
      assert.ok(m.scrollWidth <= c.w + 1, c.id + ' horizontal scroll ' + m.scrollWidth);
      assert.equal(m.h1Count, 1, c.id + ' single h1');
      assert.ok(m.mainExists && m.skipExists, c.id + ' landmarks and skip link');
      assert.equal(m.navLinks.length, 6, c.id + ' visible primary navigation');
      assert.ok(m.navLinks.every(v => v.visible && v.width >= 24 && v.height >= 24), c.id + ' mobile nav tap targets');
      assert.equal(m.missingImageAlt, 0, c.id + ' images with alt');
      assert.equal(m.unnamedLinks, 0, c.id + ' named hyperlinks');
      assert.equal(m.reducedMotion, true, c.id + ' reduced motion');
      if (c.route === '/') {
        assert.ok(m.video.every(v => !v.autoplay && v.preload === 'none'), 'Notch lazy media contract');
        assert.equal(m.mediaRequests.length, 0, c.id + ' browser must not request animation under reduced motion');
        const raw = served.slice(begin).filter(v => v.pathname.endsWith('.mp4'));
        assert.deepEqual(raw, [], c.id + ' server must not receive any MP4 request with reduced motion');
      }
      const axe = await browser('a11y', '--tags', 'wcag2a,wcag2aa,wcag21aa,wcag22aa');
      const violations = axe.violations ?? [];
      assert.equal(violations.length, 0,
        c.id + ' axe-core violations: ' + violations.map(v => v.id + ':' + v.nodes?.length).join(','));
      const destination = path.join(current, c.id + '.png');
      await browser('screenshot', ...(c.selector ? [c.selector] : []), destination);
      const baseline = path.join(baselines, c.id + '.png');
      let difference = 0;
      if (update) {
        fs.copyFileSync(destination, baseline);
      } else {
        assert.ok(fs.existsSync(baseline), c.id + ' missing baseline: run --update after reviewing visuals');
        const diff = await browser('diff', 'screenshot', '--baseline', baseline, '--threshold', '0.16', '--output', path.join(diffs, c.id + '.png'), ...(c.selector ? ['--selector', c.selector] : []));
        difference = diff.mismatchPercentage;
      }
      // A pixel change is collected, not thrown, so one run captures every changed screen in tests/visual/current.
      const pixelsOk = update || difference <= 8;
      if (!pixelsOk) pixelFailures.push(c.id + ` changed ${difference}% of pixels (limit 8%)`);
      results.push({ id: c.id, route: c.route, viewport: `${c.w}x${c.h}`, screenshot: path.relative(root, baseline), mismatchPercentage: difference, status: pixelsOk ? 'PASS' : 'PIXEL_CHANGE' });
      console.log(`${pixelsOk ? 'PASS' : 'FAIL'} ${c.id} viewport=${c.w}x${c.h} mismatch=${difference}%`);
    }

    // Filter edge cases: no-results message and accessible reset.
    await browser('set', 'viewport', '390', '844');
    await browser('open', base + '/research/explore/');
    await browser('fill', '#evidence-query', 'no-published-experiment-has-this-name');
    const { result: noMatch } = await browser('eval', "({visible:[...document.querySelectorAll('#evidence-list .evidence-card')].filter(e=>!e.hidden).length,emptyHidden:document.querySelector('#evidence-empty')?.hidden,search:new URLSearchParams(location.search).get('q')})");
    assert.equal(noMatch.visible,0,'search should return no unrelated findings');
    assert.equal(noMatch.emptyHidden,false,'no-match explanation must appear');
    assert.equal(noMatch.search,'no-published-experiment-has-this-name','search query should be shareable');
    await browser('click', '#evidence-controls button[type=reset]');
    await browser('wait', '75');
    const { result: resetResult } = await browser('eval', "({visible:[...document.querySelectorAll('#evidence-list .evidence-card')].filter(e=>!e.hidden).length,total:document.querySelectorAll('#evidence-list .evidence-card').length,emptyHidden:document.querySelector('#evidence-empty')?.hidden,search:new URLSearchParams(location.search).get('q')})");
    assert.equal(resetResult.visible,resetResult.total,'reset should restore every entry');
    assert.equal(resetResult.emptyHidden,true,'empty-state message must hide when records return');
    assert.equal(resetResult.search,null,'reset should clear shareable search parameters');
    console.log('PASS evidence explorer zero-results and reset behaviors with shareable query state');

    // Real keyboard navigation: skip-to-main and native detail disclosure.
    await browser('set', 'viewport', '390', '844');
    await browser('open', base + '/');
    await browser('press', 'Tab');
    const { result: focused } = await browser('eval', "({href:document.activeElement?.getAttribute('href'),text:document.activeElement?.textContent?.trim()})");
    assert.equal(focused.href, '#main', 'first Tab should expose the skip-to-content control');
    await browser('press', 'Enter');
    const { result: skipped } = await browser('eval', 'location.hash');
    assert.equal(skipped, '#main', 'Enter activates the skip link');
    const { result: initialOpen } = await browser('eval', "document.querySelector('details')?.open");
    assert.equal(typeof initialOpen, 'boolean', 'native details available');
    await browser('focus', 'details summary');
    await browser('press', 'Space');
    const { result: afterOpen } = await browser('eval', "document.querySelector('details')?.open");
    assert.notEqual(initialOpen, afterOpen, 'Space toggles native disclosure for keyboard users');
    console.log('PASS keyboard skip link and disclosure operate without custom JavaScript');

    // Positive check: the native hero animation still starts when actually visible.
    await browser('set', 'viewport', '1440', '900');
    await browser('set', 'media', 'dark');
    await browser('open', base + '/');
    await browser('wait', '650');
    const { result: motion } = await browser('eval', metricsJS);
    assert.equal(motion.reducedMotion, false, 'normal motion restored');
    assert.ok(served.some(v => v.pathname === '/assets/notch-v13.mp4'), 'the visible Notch intro must request its video only under normal motion');
    assert.equal(motion.video[0].paused, false, 'the visible Notch intro must actually play');
    console.log('PASS visible Notch animation loads only under normal motion');
    // Mobile normal-motion uses the new lower-transfer encode. Desktop keeps
    // the untouched high-resolution master and full color profile.
    const mobileStart = served.length;
    await browser('set', 'viewport', '390', '844');
    await browser('set', 'media', 'dark');
    await browser('open', base + '/');
    await browser('wait', '850');
    const { result: mobileMedia } = await browser('eval', "({currentSrc:document.querySelector('.notch-video')?.currentSrc,loopSrc:document.querySelector('.notch-loop')?.src,paused:document.querySelector('.notch-video')?.paused})");
    const mobileRequests = served.slice(mobileStart).filter(v => v.pathname.endsWith('.mp4')).map(v => v.pathname);
    assert.ok(mobileRequests.includes('/assets/notch-v13-mobile.mp4'), 'mobile must fetch optimized intro instead of desktop master');
    assert.ok(!mobileRequests.includes('/assets/notch-v13.mp4'), 'mobile must not fetch the full-resolution intro');
    assert.ok(mobileMedia.currentSrc.endsWith('/assets/notch-v13-mobile.mp4'), 'mobile video selected the wrong <source>');
    assert.ok(mobileMedia.loopSrc.endsWith('/assets/notch-loop-mobile.mp4'), 'mobile sway loop selected the wrong size');
    assert.equal(mobileMedia.paused, false, 'mobile intro must still play');
    console.log('PASS mobile Notch selects optimized intro/loop and keeps native playback');


    assert.equal(pixelFailures.length, 0, `${pixelFailures.length} screen(s) changed beyond the threshold; review tests/visual/current and run --update: ` + pixelFailures.join('; '));
    fs.writeFileSync(path.join(root, 'tests/visual/last-run.json'), JSON.stringify({ mode: update ? 'update' : 'verify', results, motion: { mediaRequests: motion.mediaRequests } }, null, 2) + '\n');
    console.log(`Visual QA: ${results.length}/${results.length} responsive screenshots and interaction checks passed`);
  } finally {
    try { await browser('close'); } catch (e) { console.error('Owned browser cleanup warning:', e.message); }
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(e => { console.error('FAIL visual QA:', e.stack || String(e)); process.exitCode = 1; });
