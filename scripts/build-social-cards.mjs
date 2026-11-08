#!/usr/bin/env node
// Source-specific social cards. No browser dependencies or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {socialPathForRoute} from './social-path.mjs';
const require=createRequire(import.meta.url);
let sharp;
try {sharp=require('sharp');}
catch {console.error('Install dev-only sharp (npm install --no-save sharp@0.35.5) or put it on NODE_PATH.');process.exit(2);}
const root=path.resolve(import.meta.dirname,'..');
const verify=process.argv.includes('--check');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const unesc=s=>String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const brandInside=fs.readFileSync(path.join(root,'favicon.svg'),'utf8').replace(/^.*?<svg[^>]*>/s,'').replace(/<\/svg>\s*$/s,'');
function allHtml(dir){
 const out=[];
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.name.startsWith('.')||['tests','node_modules','assets','docs'].includes(e.name))continue;
  const f=path.join(dir,e.name);
  if(e.isDirectory())out.push(...allHtml(f));
  else if(e.name==='index.html'&&f!==path.join(root,'index.html'))out.push(f);
 }
 return out;
}
function meta(html,key,attr='property'){
 const pre='<meta '+attr+'="'+key+'" content="';
 const a=html.indexOf(pre);assert.ok(a>=0,'missing '+key);
 const b=html.indexOf('">',a+pre.length);assert.ok(b>a,'unclosed '+key);
 return unesc(html.slice(a+pre.length,b));
}
function setMeta(html,key,attr,value){
 const pre='<meta '+attr+'="'+key+'" content="';
 const a=html.indexOf(pre);assert.ok(a>=0,'missing '+key);
 const b=html.indexOf('">',a+pre.length);assert.ok(b>a,'unclosed '+key);
 return html.slice(0,a+pre.length)+esc(value)+html.slice(b);
}
function width(s,size){
 let n=0;
 for(const ch of s)n+=size*(/[ilI1.,:;]/.test(ch)?.26:/[mwMW%]/.test(ch)?.8:/[A-Z]/.test(ch)?.62:/\s/.test(ch)?.30:.52);
 return n;
}
function lineLayout(text){
 let size=text.length<46?66:text.length<74?55:text.length<105?46:39,lines=[];
 const layout=()=>{
  lines=[];
  for(const word of text.split(/\s+/)){
   const prior=lines.at(-1)||'',next=prior?prior+' '+word:word;
   if(width(next,size)>680&&prior)lines.push(word);
   else if(lines.length)lines[lines.length-1]=next;
   else lines.push(next);
  }
 };
 layout();
 while(lines.length>5&&size>29){size-=3;layout();}
 assert.ok(lines.length<=5,'unrenderable social title '+text);
 return {size,lines};
}
function label(route){
 if(route.startsWith('/notes/')&&route!=='/notes/')return 'Research note';
 if(route.startsWith('/research/records/'))return 'Published research record';
 if(route.startsWith('/research/explore/'))return 'Evidence explorer';
 if(route.startsWith('/evidence/'))return 'Placement evidence';
 if(route.startsWith('/security/')&&route!=='/security/')return 'Security advisory';
 if(route==='/start/')return 'One-minute guide';
 if(route==='/methods/')return 'How I check results';
 if(route==='/research/')return 'Research record';
 if(route==='/publications/')return 'Publications';
 return 'Independent research';
}
function cardSVG(route,title){
 const {size,lines}=lineLayout(title);
 const titleLines=lines.map((x,i)=>'<text x="64" y="'+(248+i*size*1.16).toFixed(1)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+size+'" font-weight="500" letter-spacing="-1.4" fill="#efede5">'+esc(x)+'</text>').join('');
 const last=248+(lines.length-1)*size*1.16;
 return [
 '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
 '<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#4c5a4b" opacity=".46"/></pattern></defs>',
 '<rect width="1200" height="630" fill="#0d0f0f"/><rect x="777" y="0" width="423" height="630" fill="#151b16"/>',
 '<rect x="777" y="0" width="423" height="630" fill="url(#dots)"/>',
 '<path d="M64 150H1138 M64 578H1138" stroke="#384139" stroke-width="1.5"/>',
 '<g transform="translate(58 44) scale(.15)">',brandInside,'</g>',
 '<text x="152" y="99" font-family="Arial,Helvetica,sans-serif" font-size="29" font-weight="650" fill="#efede5">MacBrains<tspan font-weight="400" fill="#b8c3b4"> Labs</tspan></text>',
 '<rect x="64" y="168" width="5" height="5" fill="#ff633a"/>',
 '<text x="80" y="177" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="600" fill="#ff9c7d">',esc(label(route)),'</text>',
 titleLines,
 '<path d="M64 '+Math.min(last+38,565).toFixed(1)+' H170" stroke="#ff633a" stroke-width="4"/>',
 '<rect x="824" y="191" width="316" height="306" fill="#182119" rx="11" stroke="#536352" stroke-width="1.5"/>',
 '<g transform="translate(847 210) scale(.595)">',brandInside,'</g>',
  '<text x="65" y="612" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#bcc5b9">macbrainslabs.org</text>',
 '<text x="824" y="612" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="#cbd5c9">Nayte Wilson · independent research</text>',
 '</svg>'
 ].join('');
}
async function run(){
 let count=0;
 for(const file of allHtml(root).sort()){
  const rel=path.relative(root,file).split(path.sep).join('/');
  const route='/'+rel.slice(0,-'index.html'.length);
  const before=fs.readFileSync(file,'utf8');
  assert.equal(meta(before,'og:url'),'https://macbrainslabs.org'+route,'canonical route mismatch');
  const title=meta(before,'og:title'),imagePath=socialPathForRoute(route);
  const imageURL='https://macbrainslabs.org'+imagePath;
  let after=before;
  for(const [key,attr,value] of [
   ['og:image','property',imageURL],
   ['og:image:secure_url','property',imageURL],
   ['twitter:image','name',imageURL],
   ['og:image:alt','property','MacBrains Labs research: '+title],
   ['twitter:image:alt','name','MacBrains Labs research: '+title]
  ])after=setMeta(after,key,attr,value);
  const svg=cardSVG(route,title),png=await sharp(Buffer.from(svg)).png({compressionLevel:9}).toBuffer();
  const out=path.join(root,imagePath.slice(1)),source=out.replace(/\.png$/i,'.svg');
  if(verify){
   assert.equal(before,after,rel+' social metadata drift');
   assert.equal(fs.readFileSync(source,'utf8'),svg,rel+' social SVG drift');
   assert.deepEqual(fs.readFileSync(out),png,rel+' social PNG drift');
  }else{
   fs.mkdirSync(path.dirname(out),{recursive:true});
   fs.writeFileSync(file,after);
   fs.writeFileSync(source,svg);
   fs.writeFileSync(out,png);
  }
  const info=await sharp(png).metadata();
  assert.equal(info.width,1200);assert.equal(info.height,630);
  assert.ok(png.length<240000,'social card unexpectedly heavy '+route);
  count++;
 }
 console.log(verify?'PASS validated':'GENERATED',count,'page-specific social previews');
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1});
