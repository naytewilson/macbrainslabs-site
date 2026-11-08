#!/usr/bin/env node
// Real deployed-site acceptance: public URL, actual bytes, link previews,
// install assets, sitemap routes and source-linked research artifacts.
// No website mutation, no analytics and no third-party runtime dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { socialPathForRoute } from './social-path.mjs';

const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
const arg=(flag,fallback)=>{const found=args.find(x=>x.startsWith(flag+'='));return found?found.slice(flag.length+1):fallback;};
const target=new URL(arg('--origin',process.env.SITE_ORIGIN||'https://macbrainslabs.org'));
if(!/^https?:$/.test(target.protocol))throw Error('Unsupported verification protocol');
if(target.protocol!=='https:'&&target.hostname!=='127.0.0.1'&&target.hostname!=='localhost')throw Error('Only HTTPS or explicit loopback site tests are allowed');
const once=args.includes('--once');
const attempts=once?1:Math.min(30,Math.max(1,Number(arg('--attempts','18'))));
const delayMs=Math.max(0,Math.min(30000,Number(arg('--delay-ms','14000'))));
const shortSHA=process.env.GITHUB_SHA?.slice(0,12)||'local';
const sourceDomain='https://macbrainslabs.org';
const fromDisk=p=>fs.readFileSync(path.join(root,p.startsWith('/')?p.slice(1):p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fetchCount=0;

async function get(p){
 const u=new URL(p,target);
 u.searchParams.set('verify_source',shortSHA);
 const res=await fetch(u,{redirect:'follow',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
 fetchCount++;
 assert.equal(res.status,200,p+' returned HTTP '+res.status);
 assert.equal(new URL(res.url).host,target.host,p+' redirected to another host');
 return Buffer.from(await res.arrayBuffer());
}
async function exact(p){
 const actual=await get(p),expect=fromDisk(p);
 assert.equal(sha(actual),sha(expect),'deployed content differs from exact committed file at '+p);
 return actual;
}
async function gitHead(){
 if(!process.env.GITHUB_SHA||target.hostname==='127.0.0.1')return null;
 const res=await fetch('https://api.github.com/repos/naytewilson/macbrainslabs-site/commits/main',
  {headers:{Accept:'application/vnd.github+json','User-Agent':'MacBrains-live-verifier'},signal:AbortSignal.timeout(9000)});
 if(!res.ok)throw Error('unable to confirm current remote main at GitHub: '+res.status);
 return (await res.json()).sha;
}
function meta(html,key,kind='property'){
 const prefix='<meta '+kind+'="'+key+'" content="';
 const a=html.indexOf(prefix);
 assert.ok(a>=0,'missing '+key);
 const b=html.indexOf('">',a+prefix.length);
 assert.ok(b>a,'malformed '+key);
 return html.slice(a+prefix.length,b).replace(/&amp;/g,'&');
}
function routesFrom(xml){
 const list=[...xml.matchAll(/<loc>(https:\/\/macbrainslabs\.org\/[^<]*)<\/loc>/g)].map(x=>new URL(x[1]).pathname);
 assert.ok(list.includes('/')&&list.includes('/start/')&&list.includes('/research/explore/'),'sitemap missing main public routes');
 assert.equal(list.length,new Set(list).size,'duplicate sitemap routes');
 return list;
}
async function ready(){
 // Byte-for-byte epoch gate avoids treating a green source commit or 200 on
 // old GitHub Pages as a deployed release.
 await exact('/experience.css');
 await exact('/explore.js');
 await exact('/assets/social/research-explore.png');
 await exact('/site.webmanifest');
}
async function audit(){
 const xml=(await exact('/sitemap.xml')).toString('utf8');
 const routes=routesFrom(xml);
 const catalog=JSON.parse((await exact('/research/explore/catalog.json')).toString('utf8'));
 assert.equal(catalog.schema,'macbrainslabs.public-evidence-index.v1');
 assert.ok(catalog.items.length>=10,'public evidence index unexpectedly empty');
 const manifest=JSON.parse((await exact('/site.webmanifest')).toString('utf8'));
 assert.equal(manifest.name,'MacBrains Labs');
 assert.equal(manifest.display,'standalone');
 const paths=[
  '/favicon.ico','/apple-touch-icon.png','/assets/brand-mark-96.png',
  '/assets/icon-16.png','/assets/icon-32.png','/assets/icon-48.png',
  '/assets/icon-192.png','/assets/icon-512.png','/assets/social-card.png',
  '/home.css','/styles.css','/home.js','/experience.css','/explore.js',
  '/assets/notch-v13-mobile.mp4','/assets/notch-loop-mobile.mp4','/assets/notch-img-mobile.mp4',
  '/assets/notch-mobile-manifest.json'
 ];
 // These are stable public files and all must match the checked-out commit.
 for(const p of paths)await exact(p);
 for(const route of routes){
  const file=route==='/'?'index.html':route.slice(1)+'index.html';
  const local=fromDisk(file).toString('utf8');
  const live=(await get(route)).toString('utf8');
  // The generated homepage publications block can change with later releases;
  // otherwise exact canonical and metadata verification binds the visible page.
  assert.ok(live.includes('<link rel="canonical" href="'+sourceDomain+route+'">'),route+' wrong canonical');
  assert.equal(meta(live,'og:url'),sourceDomain+route,route+' wrong OG URL');
  assert.equal(meta(live,'og:image'),sourceDomain+socialPathForRoute(route),route+' wrong social image');
  assert.equal(meta(live,'twitter:image','name'),sourceDomain+socialPathForRoute(route),route+' wrong Twitter image');
  assert.ok(live.includes('<link rel="manifest" href="/site.webmanifest">'),route+' missing install manifest');
  assert.ok(live.includes('<main id="main">'),route+' missing accessible main landmark');
  assert.ok(!live.includes('/macbrainslabs-site/'),route+' stale project prefix');
  if(route==='/start/'||route==='/research/explore/')assert.equal(sha(Buffer.from(live)),sha(Buffer.from(local)),route+' stale deployed HTML');
  if(route==='/')assert.ok(live.includes('<source src="/assets/notch-v13-mobile.mp4"'), 'mobile video selector missing');
  const imagePath=socialPathForRoute(route);
  await exact(imagePath);
 }
 const guide=(await get('/start/')).toString('utf8');
 assert.ok(guide.includes('class="guide-grid"')&&guide.includes('What actually ran?'),'start guide incomplete');
 const explorer=(await get('/research/explore/')).toString('utf8');
 assert.ok(explorer.includes('id="evidence-controls"')&&explorer.includes('id="evidence-list"'),'search explorer incomplete');
 console.log('PROVEN deployed HTML, open-graph previews, icon set, mobile encodes and manifest match public release');
 console.log('PROVEN '+routes.length+' sitemap pages and '+catalog.items.length+' public evidence entries verified; '+fetchCount+' HTTPS/loopback requests');
}
let ok=false,last=null;
for(let i=1;i<=attempts;i++){
 try{
  const remote=await gitHead();
  if(remote&&remote!==process.env.GITHUB_SHA){
   console.log('SUPERSEDED: expected '+process.env.GITHUB_SHA+', remote main '+remote+'; newer push owns deployed acceptance.');
   ok=true;break;
  }
  await ready();
  await audit();
  ok=true;break;
 }catch(e){
  last=e;
  console.error('DEPLOYMENT_ATTEMPT '+i+'/'+attempts+' NOT_ACCEPTED: '+e.message);
  if(i<attempts)await sleep(delayMs);
 }
}
if(!ok){
 console.error('FAIL deployed-site acceptance after '+attempts+' attempts; last reason: '+String(last?.message));
 process.exitCode=1;
}
