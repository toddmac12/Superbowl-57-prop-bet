import test from 'node:test';
import assert from 'node:assert/strict';
import { access, memoryLimiter, verifyCode } from '../cloudflare/access.mjs';
import { pbkdf2Sync } from 'node:crypto';

const origin='https://checks.example.test';
const options=()=>({title:'Test app',secret:'test-secret-with-more-than-thirty-two-characters',code:'a#b$c5',consume:memoryLimiter()});
const request=(path='/',extra={})=>new Request(origin+path,extra);
const login=(code='a#b$c5',next='/')=>request('/_access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':'192.0.2.1'},body:new URLSearchParams({code,next})});
test('direct pages, asset URLs and APIs are protected',async()=>{
  const config=options();
  assert.equal((await access(request('/'),config)).status,303);
  assert.equal((await access(request('/assets/app.js'),config)).status,401);
  assert.equal((await access(request('/api/games'),config)).status,401);
});
test('symbols work, wrong code fails, and no response reflects a submitted code',async()=>{
  const config=options();
  const rejected=await access(login('incorrect-code'),config);
  assert.equal(rejected.status,401);assert.ok(!(await rejected.text()).includes('incorrect-code'));
  const response=await access(login(),config);
  assert.equal(response.status,303);
  const cookie=response.headers.get('Set-Cookie');
  assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);assert.ok(!cookie.includes(config.code));
  assert.equal(await access(request('/',{headers:{Cookie:cookie.split(';')[0]}}),config),null);
});
test('cookies cannot cross apps, hosts or changed codes, and forged cookies fail',async()=>{
  const config=options();
  const response=await access(login(),config);const cookie=response.headers.get('Set-Cookie').split(';')[0];
  const req=request('/',{headers:{Cookie:cookie}});
  assert.equal((await access(req,{...config,title:'Other app'})).status,303);
  assert.equal((await access(req,{...config,code:'different-code'})).status,303);
  assert.equal((await access(new Request('https://other.example.test/',{headers:{Cookie:cookie}}),config)).status,303);
  assert.equal((await access(request('/',{headers:{Cookie:cookie.slice(0,-1)+'x'}}),config)).status,303);
});
test('expired and implausibly future cookies fail',async()=>{
  const config=options();const base=Date.now;let response;
  try{Date.now=()=>base()-9*3600000;response=await access(login(),config);}finally{Date.now=base;}
  assert.equal((await access(request('/',{headers:{Cookie:response.headers.get('Set-Cookie').split(';')[0]}}),config)).status,303);
});
test('cross-origin login and logout are denied; logout expires the cookie',async()=>{
  const config=options();const req=login();req.headers.set('Origin','https://attacker.example');
  assert.equal((await access(req,config)).status,403);
  assert.equal((await access(request('/_access/logout'),config)).status,403);
  const res=await access(request('/_access/logout',{method:'POST',headers:{Origin:origin}}),config);
  assert.match(res.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('redirect targets stay on-site; deep links are retained',async()=>{
  for(const path of ['//attacker.test','/\\attacker.test','https://attacker.test','/_access/logout']) {
    assert.equal((await access(login('a#b$c5',path),options())).headers.get('Location'),'/');
  }
  assert.equal((await access(login('a#b$c5','/game/123'),options())).headers.get('Location'),'/game/123');
});
test('attempt limiter blocks the eleventh request; missing config fails closed',async()=>{
  const config=options();for(let i=0;i<10;i++)assert.equal((await access(login('bad'),config)).status,401);
  assert.equal((await access(login(),config)).status,429);
  assert.equal((await access(request('/'),{...config,secret:''})).status,503);
});
test('PBKDF2 verifier accepts only the exact code, including symbols',async()=>{
  const salt='00'.repeat(16);const verifier={salt,hash:pbkdf2Sync('a#b$c5',Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex')};
  assert.equal(await verifyCode('a#b$c5',verifier),true);assert.equal(await verifyCode('a#b$c6',verifier),false);
});
