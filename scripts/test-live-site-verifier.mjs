#!/usr/bin/env node
// Real HTTP acceptance, plus fail-closed corruption control, without network,
// credential access, external dependencies or modifying the repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
let corrupt=false;
const server=http.createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const relative=decodeURIComponent(url.pathname).replace(/^\/+/,'');
  const absolute=path.resolve(root,relative,url.pathname.endsWith('/')?'index.html':'');
  if(!absolute.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const stat=fs.statSync(absolute);
  if(!stat.isFile())throw Error('not file');
  let contents=fs.readFileSync(absolute);
  if(corrupt&&url.pathname==='/assets/social/research-explore.png'){
   contents=Buffer.from(contents);
   contents[contents.length-5]^=0x04;
  }
  res.writeHead(200,{'Content-Type':absolute.endsWith('.png')?'image/png':absolute.endsWith('.webmanifest')?'application/manifest+json':absolute.endsWith('.html')?'text/html':'application/octet-stream','Content-Length':contents.length,'Cache-Control':'no-store'});
  res.end(contents);
 }catch(e){res.writeHead(404).end(String(e.message));}
});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function check(port){
 try{
  return await exec(process.execPath,['scripts/verify-live-site.mjs','--origin=http://127.0.0.1:'+port,'--once'],{cwd:root,env:{...process.env,GITHUB_SHA:''},maxBuffer:256*1024,timeout:60000});
 }catch(e){return {stdout:e.stdout||'',stderr:e.stderr||'',failed:true,error:e};}
}
const port=await listen();
try{
 const good=await check(port);
 assert.ok(!good.failed,'healthy HTTP verifier failed: '+good.stderr);
 assert.match(good.stdout,/PROVEN deployed HTML/);
 assert.match(good.stdout,/public evidence entries verified/);
 console.log('PASS exact-root HTTP release acceptance detects every deployed resource');
 corrupt=true;
 const bad=await check(port);
 assert.ok(bad.failed,'verifier accepted corrupted social PNG');
 assert.match(bad.stderr,/deployed content differs from exact committed file/);
 console.log('PASS fail-closed: corrupted public social preview is detected and rejected');
}finally{
 await new Promise(resolve=>server.close(resolve));
}
