'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../shared/domain');
const KEY='cloudflare-integration-fixture-key-32-characters';
const CODE='integration-fixture-code';
test('Cloudflare SQLite runtime keeps private entries, transactions, receipts, and asset boundaries',async t=>{
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'picks-cf-'));
  const port=18789,origin='http://127.0.0.1:'+port;
  let logs='';const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',dir,'--var','PUBLIC_ORIGIN:'+origin,'--var','ORGANIZER_KEY:'+KEY,'--var','APP_ACCESS_CODE:'+CODE],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',v=>{logs+=v;});child.stderr.on('data',v=>{logs+=v;});
  t.after(async()=>{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/_access');if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,logs);
  assert.equal((await fetch(origin+'/api/session')).status,401);
  assert.equal((await fetch(origin+'/hosted.js')).status,401);
  const unlock=await fetch(origin+'/_access',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:CODE})});
  assert.equal(unlock.status,303);
  const gateCookie=unlock.headers.get('Set-Cookie').split(';')[0];
  function client(){let cookies=gateCookie,csrf='';return{async request(method,route,data,extra={}){const r=await fetch(origin+route,{method,headers:{Cookie:cookies,...(data?{'Content-Type':'application/json',Origin:origin}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});const cookie=r.headers.getSetCookie();if(cookie.length){const jar=new Map(cookies.split('; ').map(s=>[s.split('=')[0],s]));for(const value of cookie){const pair=value.split(';')[0];jar.set(pair.split('=')[0],pair);}cookies=[...jar.values()].join('; ');}const body=await r.json();if(body.csrf)csrf=body.csrf;return{status:r.status,body,headers:r.headers};}};}
  const admin=client();assert.equal((await admin.request('POST','/api/organizer/login',{key:KEY})).status,200);
  const future=Date.now()+3600000,settings={title:'Cloudflare integration',season:2026,kickoffAt:new Date(future+3600000).toISOString(),lockAt:new Date(future).toISOString(),revealAt:new Date(future+3600000).toISOString(),config:{teamA:'Team A',teamB:'Team B',players:Object.fromEntries(['qbA','qbB','receiverA','receiverA2','receiverB','receiverB2','rbA','rbB'].map(k=>[k,k])),thresholds:{}}};
  let r=await admin.request('POST','/api/organizer/games',settings);assert.equal(r.status,201,JSON.stringify(r.body));const game=r.body.game;
  assert.equal((await admin.request('POST','/api/organizer/games/'+game.id+'/publish',{gameVersion:game.questionVersion})).status,200);
  const person=client(),accessKey=D.secret();r=await person.request('POST','/api/games/'+game.id+'/entries',{name:'Mobile player',accessKey,consent:true,gameVersion:game.questionVersion});assert.equal(r.status,201,JSON.stringify(r.body));
  const picks=Object.fromEntries(game.questions.map(q=>[q.id,q.options[0].value]));
  assert.equal((await person.request('PUT','/api/entry/draft',{expectedRevision:0,gameVersion:game.questionVersion,picks},{Origin:'https://other.example'})).status,403);
  const drafts=await Promise.all([1,2].map(()=>person.request('PUT','/api/entry/draft',{expectedRevision:0,gameVersion:game.questionVersion,picks})));
  assert.deepEqual(drafts.map(r=>r.status).sort(),[200,409]);
  const payload={expectedRevision:1,gameVersion:game.questionVersion,picks,requestId:D.secret()};r=await person.request('POST','/api/entry/submit',payload);assert.equal(r.status,200,JSON.stringify(r.body));const receipt=r.body.receipt.id;
  assert.equal((await person.request('POST','/api/entry/submit',payload)).body.receipt.id,receipt);
  assert.equal((await client().request('GET','/api/entry')).status,401);
  assert.deepEqual((await client().request('GET','/api/games/'+game.id+'/leaderboard')).body.rows,[]);
  const reopened=client();assert.equal((await reopened.request('POST','/api/access/exchange',{accessKey})).status,200);assert.equal((await reopened.request('GET','/api/entry')).body.entry.receipt.id,receipt);
  for(const file of ['/shared/handler.js','/wrangler.jsonc','/.dev.vars','/App_Data/shared.db'])assert.equal((await fetch(origin+file,{headers:{Cookie:gateCookie}})).status,404);
  for(const file of ['/','/entry','/organizer','/game/'+game.id,'/hosted.js','/offline.html']){const asset=await fetch(origin+file,{headers:{Cookie:gateCookie}});assert.equal(asset.status,200,file);assert.equal(asset.headers.get('x-frame-options'),'DENY');assert.equal(asset.headers.get('Cache-Control'),'private, no-store');}
  // Durable storage limits attempts even when requests run concurrently across Worker instances.
  const attempts=await Promise.all(Array.from({length:12},()=>fetch(origin+'/_access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:'wrong'})})));
  assert.ok(attempts.some(r=>r.status===429));
});
