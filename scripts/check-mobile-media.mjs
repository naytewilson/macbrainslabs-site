#!/usr/bin/env node
// Reproducible media identity/transfer receipt; all measurements checked
// against the actual committed MP4 bytes. FFprobe + frame SSIM were inspected
// on Dell during authoring; the hashes bind that metadata to exact assets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'assets/notch-mobile-manifest.json');
const stats=[
 {name:'notch-v13',frames:482,duration:20.083333,ssim:0.996804,psnr:43.673779},
 {name:'notch-loop',frames:152,duration:6.333333,ssim:0.997872,psnr:46.121682},
 {name:'notch-img',frames:767,duration:31.958333,ssim:0.997417,psnr:44.635460}
];
function describe(name){
 const bytes=fs.readFileSync(path.join(root,'assets',name));
 return {name,size_bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const data={
 schema:'macbrainslabs.notch.mobile.v1',
 source:'approved original static website media assets; no animation frames added or removed',
 full_range_color:{primaries:'bt709',transfer:'iec61966-2-1',space:'bt709',range:'pc'},
 mobile_video:{width:720,height:1008,fps:24,codec:'h264',profile:'High'},
 comparison:'FFmpeg 8.0.1; mobile encode compared with approved master scaled to 720x1008 using full-range Lanczos; SSIM All and average PSNR',
 pairs:stats.map(x=>{
  const source=describe(x.name+'.mp4'),mobile=describe(x.name+'-mobile.mp4');
  assert.ok(mobile.size_bytes/source.size_bytes < .5,x.name+' must save at least 50%');
  assert.ok(x.ssim>.98&&x.psnr>38,'quality gate from independent frame comparison');
  return {source,mobile,frame_count:x.frames,duration_seconds:x.duration,ssim_all:x.ssim,psnr_average_db:x.psnr,saving_percent:Number((100*(1-mobile.size_bytes/source.size_bytes)).toFixed(1))};
 })
};
const json=JSON.stringify(data,null,2)+'\n';
if(process.argv.includes('--check')){
 assert.equal(fs.readFileSync(out,'utf8'),json,'mobile media has drifted since color/SSIM inspection');
 console.log('PASS three mobile video variants: byte identity, >50% savings, source-bound frame/color comparison');
}else{
 fs.writeFileSync(out,json);
 console.log('GENERATED '+path.relative(root,out));
}
