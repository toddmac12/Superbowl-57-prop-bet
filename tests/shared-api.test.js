'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../shared/domain');
const {createApplication}=require('../shared/server');
const KEY='organizer-test-key-with-more-than-32-characters';
const BASE=Date.parse('2027-01-01T12:00:00Z');
function settings(){return{title:'Super Bowl test game',season:2026,kickoffAt:new Date(BASE+3*3600000).toISOString(),lockAt:new Date(BASE+2*3600000).toISOString(),revealAt:new Date(BASE+3*3600000).toISOString(),config:{teamA:'Eagles',teamB:'Chiefs',players:{qbA:'Jalen Hurts',qbB:'Patrick Mahomes',receiverA:'A.J. Brown',receiverA2:'DeVonta Smith',receiverB:'Travis Kelce',receiverB2:'Jerick McKinnon',rbA:'Miles Sanders',rbB:'Isiah Pacheco'},thresholds:{}}};}
async function fixture(t,dbPath=':memory:'){
  let time=BASE,origin='';const errors=[];
  const app=createApplication({dbPath,organizerKey:KEY,now:()=>time,publicOrigin:()=>origin,onError:e=>errors.push(e)});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+app.server.address().port;
  t.after(()=>app.close());
  function client(){const jar=new Map();let csrf='';return{get csrf(){return csrf;},async request(method,url,data,extra={}){
    const headers={...(jar.size?{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra};
    const response=await fetch(origin+url,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
    const body=await response.json();if(body.csrf)csrf=body.csrf;return{status:response.status,body,headers:response.headers};
  } };}
  const admin=client();assert.equal((await admin.request('POST','/api/organizer/login',{key:KEY})).status,200);
  async function create(publish=true,value=settings()){
    const created=await admin.request('POST','/api/organizer/games',value);assert.equal(created.status,201,JSON.stringify(created.body));
    if(!publish)return created.body.game;
    const result=await admin.request('POST','/api/organizer/games/'+created.body.game.id+'/publish',{gameVersion:created.body.game.questionVersion});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.game;
  }
  async function join(game,name='Alice',person=client()){
    const accessKey=D.secret(),payload={name,accessKey,consent:true,gameVersion:game.questionVersion};
    const result=await person.request('POST','/api/games/'+game.id+'/entries',payload);assert.equal(result.status,201,JSON.stringify(result.body));
    return{person,accessKey,payload,entry:result.body.entry};
  }
  const picks=game=>Object.fromEntries(game.questions.map(q=>[q.id,q.options[0].value]));
  return{app,admin,client,create,join,picks,errors,origin,setTime:value=>{time=value;}};
}

test('games freeze question snapshots, keep season/year separate, and hide drafts',async t=>{
  const f=await fixture(t),draft=await f.create(false);
  assert.equal(draft.gameYear,2027);assert.equal(draft.season,2026);assert.equal(draft.questions.length,25);
  const guest=f.client();assert.equal((await guest.request('GET','/api/games/'+draft.id)).status,404);
  const published=await f.admin.request('POST','/api/organizer/games/'+draft.id+'/publish',{gameVersion:draft.questionVersion});assert.equal(published.status,200);
  assert.equal((await f.admin.request('PUT','/api/organizer/games/'+draft.id,{...settings(),gameVersion:draft.questionVersion})).status,409);
  const list=(await guest.request('GET','/api/games')).body.games;assert.equal(list.length,1);assert.equal(list[0].id,draft.id);
});

test('participant gets private access, partial draft, complete receipt, and idempotent retry',async t=>{
  const f=await fixture(t),game=await f.create(),{person,entry}=await f.join(game);
  assert.equal((await person.request('POST','/api/entry/submit',{gameVersion:game.questionVersion,expectedRevision:0,picks:{},requestId:D.secret()})).status,400);
  const draft=await person.request('PUT','/api/entry/draft',{gameVersion:game.questionVersion,expectedRevision:0,picks:{'coin-toss':'tails'}});
  assert.equal(draft.status,200);assert.equal(draft.body.entry.revision,1);assert.equal(draft.body.entry.submitted,null);
  const payload={gameVersion:game.questionVersion,expectedRevision:1,picks:f.picks(game),requestId:D.secret()};
  const result=await person.request('POST','/api/entry/submit',payload);assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.receipt.id);assert.equal(result.body.entry.revision,2);
  f.setTime(Date.parse(game.lockAt));
  const repeated=await person.request('POST','/api/entry/submit',payload);assert.equal(repeated.status,200);assert.equal(repeated.body.receipt.id,result.body.receipt.id);assert.equal(repeated.body.replayed,true);
  assert.equal((await person.request('POST','/api/entry/submit',{...payload,requestId:D.secret(),expectedRevision:2})).status,423);
  assert.equal(f.app.db.prepare('SELECT count(*) as n FROM receipts WHERE entry_id=?').get(entry.id).n,1);
  assert.deepEqual(f.errors,[]);
});

test('idempotence treats reordered answers as the same submission and rejects reused key with other picks',async t=>{
  const f=await fixture(t),g=await f.create(),{person}=await f.join(g);const picks=f.picks(g),payload={gameVersion:g.questionVersion,expectedRevision:0,picks,requestId:D.secret()};
  const accepted=await person.request('POST','/api/entry/submit',payload);assert.equal(accepted.status,200);
  const reordered={...payload,picks:Object.fromEntries(Object.entries(picks).reverse())};assert.equal((await person.request('POST','/api/entry/submit',reordered)).status,200);
  assert.equal((await person.request('POST','/api/entry/submit',{...payload,picks:{...picks,'coin-toss':'tails'}})).status,409);
});

test('server rejects late drafts and new submissions at the exact deadline',async t=>{
  const f=await fixture(t),g=await f.create(),{person}=await f.join(g);f.setTime(Date.parse(g.lockAt));
  const payload={gameVersion:g.questionVersion,expectedRevision:0,picks:f.picks(g)};
  assert.equal((await person.request('PUT','/api/entry/draft',payload)).status,423);
  assert.equal((await person.request('POST','/api/entry/submit',{...payload,requestId:D.secret()})).status,423);
  assert.equal((await f.client().request('POST','/api/games/'+g.id+'/entries',{name:'Late',accessKey:D.secret(),consent:true,gameVersion:g.questionVersion})).status,423);
});

test('one authoritative acceptance instant is before the lock',async t=>{
  const f=await fixture(t),g=await f.create(),{person}=await f.join(g);f.setTime(Date.parse(g.lockAt)-1);
  const r=await person.request('POST','/api/entry/submit',{gameVersion:g.questionVersion,expectedRevision:0,picks:f.picks(g),requestId:D.secret()});assert.equal(r.status,200);assert.ok(Date.parse(r.body.receipt.acceptedAt)<Date.parse(g.lockAt));
});

test('stale revisions and wrong game versions cannot overwrite accepted picks',async t=>{
  const f=await fixture(t),g=await f.create(),{person}=await f.join(g);
  const payload={gameVersion:g.questionVersion,expectedRevision:0,picks:f.picks(g),requestId:D.secret()};assert.equal((await person.request('POST','/api/entry/submit',payload)).status,200);
  assert.equal((await person.request('PUT','/api/entry/draft',{...payload,picks:{}})).status,409);
  assert.equal((await person.request('PUT','/api/entry/draft',{...payload,expectedRevision:1,gameVersion:'other'})).status,409);
  const draft=await person.request('PUT','/api/entry/draft',{gameVersion:g.questionVersion,expectedRevision:1,picks:{'coin-toss':'tails'}});assert.equal(draft.status,200);assert.deepEqual(draft.body.entry.submitted,payload.picks);
});

test('private picks and recovery credentials are hidden until reveal, including organizer entry lists',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g,'Alice'),b=await f.join(g,'Bob');
  await a.person.request('POST','/api/entry/submit',{gameVersion:g.questionVersion,expectedRevision:0,picks:f.picks(g),requestId:D.secret()});
  const guest=f.client();assert.equal((await guest.request('GET','/api/entry')).status,401);
  assert.equal((await b.person.request('GET','/api/entry')).body.entry.name,'Bob');
  assert.equal((await b.person.request('GET','/api/entry/'+a.entry.id)).status,404);
  const before=(await guest.request('GET','/api/games/'+g.id+'/leaderboard')).body;assert.deepEqual(before.rows,[]);
  const adminEntries=(await f.admin.request('GET','/api/organizer/games/'+g.id+'/entries')).body.entries;
  assert.equal(adminEntries[0].picks,undefined);assert.ok(!JSON.stringify(adminEntries).includes(a.accessKey));
  f.setTime(Date.parse(g.revealAt));const publicRows=(await guest.request('GET','/api/games/'+g.id+'/leaderboard')).body.rows;
  assert.equal(publicRows.length,1);assert.equal(publicRows[0].name,'Alice');assert.equal(publicRows[0].picks['coin-toss'],'heads');assert.ok(!JSON.stringify(publicRows).includes(a.accessKey));
});

test('organizer corrections are versioned, sourced and reflected in scores without changing entries',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g);await a.person.request('POST','/api/entry/submit',{gameVersion:g.questionVersion,expectedRevision:0,picks:f.picks(g),requestId:D.secret()});
  const body={expectedRevision:0,results:{'coin-toss':'heads','first-quarter':'void'},reason:'Verified against game record',source:'https://example.com/game',final:false};
  assert.equal((await f.admin.request('PUT','/api/organizer/games/'+g.id+'/results',body)).status,409);
  f.setTime(Date.parse(g.lockAt));assert.equal((await f.admin.request('PUT','/api/organizer/games/'+g.id+'/results',body)).status,200);
  assert.equal((await f.admin.request('PUT','/api/organizer/games/'+g.id+'/results',body)).status,409);
  assert.equal((await f.client().request('GET','/api/games/'+g.id+'/audit')).status,404);
  f.setTime(Date.parse(g.revealAt));const score=(await f.client().request('GET','/api/games/'+g.id+'/leaderboard')).body.rows[0];assert.equal(score.correct,1);assert.equal(score.settled,1);assert.equal(score.voided,1);
  const events=(await f.client().request('GET','/api/games/'+g.id+'/audit')).body.events;assert.equal(events.length,1);assert.equal(events[0].status,'provisional');assert.equal(events[0].source,body.source);
});

test('recovery rotation revokes both the old link and existing sessions',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g);
  const rotated=await f.admin.request('POST','/api/organizer/entries/'+a.entry.id+'/rotate',{reason:'Verified participant in person'});assert.equal(rotated.status,200);
  assert.equal((await a.person.request('GET','/api/entry')).status,401);
  assert.equal((await f.client().request('POST','/api/access/exchange',{accessKey:a.accessKey})).status,401);
  const next=f.client();assert.equal((await next.request('POST','/api/access/exchange',{accessKey:new URL(rotated.body.managementLink).hash.slice(8)})).status,200);
  assert.equal((await next.request('GET','/api/entry')).body.entry.id,a.entry.id);
});

test('registration retry is idempotent and normalized duplicate names are rejected',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g);
  const retry=await a.person.request('POST','/api/games/'+g.id+'/entries',a.payload);assert.equal(retry.body.entry.id,a.entry.id);
  assert.equal((await f.client().request('POST','/api/games/'+g.id+'/entries',{...a.payload,name:'ＡＬＩＣＥ',accessKey:D.secret()})).status,409);
  assert.equal(f.app.db.prepare('SELECT count(*) as n FROM entries').get().n,1);
});

test('auth requires separate credentials, CSRF and exact origin; only hashes are stored',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g),guest=f.client();
  assert.equal((await a.person.request('GET','/api/organizer/games')).status,401);
  assert.equal((await guest.request('POST','/api/organizer/login',{key:'wrong'})).status,401);
  const payload={gameVersion:g.questionVersion,expectedRevision:0,picks:{}};
  assert.equal((await a.person.request('PUT','/api/entry/draft',payload,{'X-CSRF-Token':''})).status,403);
  assert.equal((await a.person.request('PUT','/api/entry/draft',payload,{Origin:'https://other.example'})).status,403);
  const row=f.app.db.prepare('SELECT * FROM entries WHERE id=?').get(a.entry.id);assert.equal(row.access_hash,D.hash(a.accessKey));assert.ok(!JSON.stringify(row).includes(a.accessKey));
  const headers=(await a.person.request('POST','/api/access/exchange',{accessKey:a.accessKey})).headers.get('set-cookie');assert.match(headers,/HttpOnly/);assert.match(headers,/SameSite=Strict/);
});

test('read-only access remains after locking, expired links fail, and private files are never served',async t=>{
  const f=await fixture(t),g=await f.create(),a=await f.join(g);f.setTime(Date.parse(g.lockAt));assert.equal((await a.person.request('GET','/api/entry')).status,200);
  f.setTime(Date.parse(g.revealAt)+91*86400000);assert.equal((await f.client().request('POST','/api/access/exchange',{accessKey:a.accessKey})).status,401);
  for(const uri of ['/App_Data/shared.db','/App_Data/organizer-key','/.env','/shared/server.js'])assert.equal((await f.client().request('GET',uri)).status,404);
});

test('invalid dates, unknown answers and inconsistent reveal times are rejected',async t=>{
  const f=await fixture(t),bad=settings();bad.revealAt=new Date(BASE+1000).toISOString();assert.equal((await f.admin.request('POST','/api/organizer/games',bad)).status,400);
  const g=await f.create(),a=await f.join(g);
  assert.equal((await a.person.request('PUT','/api/entry/draft',{gameVersion:g.questionVersion,expectedRevision:0,picks:{'coin-toss':'chiefs'}})).status,400);
  assert.equal((await a.person.request('PUT','/api/entry/draft',{gameVersion:g.questionVersion,expectedRevision:0,picks:{unknown:'yes'}})).status,400);
});

test('separate yearly games do not mix entries or question versions',async t=>{
  const f=await fixture(t),g1=await f.create(),config=settings();config.title='Another year';config.season=2027;config.kickoffAt='2028-02-13T23:30:00Z';config.lockAt='2028-02-13T23:00:00Z';config.revealAt=config.kickoffAt;config.config.teamA='New Team';const g2=await f.create(true,config);
  await f.join(g1,'Alice');await f.join(g2,'Alice');assert.notEqual(g1.questionVersion,g2.questionVersion);
  const list=(await f.client().request('GET','/api/games')).body.games;assert.deepEqual(list.map(g=>g.gameYear),[2028,2027]);
});

test('submitted data and organizer audit persist after server restart',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shared-persist-')),file=path.join(directory,'shared.db');t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let time=BASE,origin='';const first=createApplication({dbPath:file,organizerKey:KEY,now:()=>time,publicOrigin:()=>origin});await new Promise(r=>first.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+first.server.address().port;
  let response=await fetch(origin+'/api/organizer/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({key:KEY})});const auth=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  response=await fetch(origin+'/api/organizer/games',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':auth.csrf},body:JSON.stringify(settings())});const created=await response.json();assert.equal(response.status,201);
  const adminHeaders={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':auth.csrf};
  response=await fetch(origin+'/api/organizer/games/'+created.game.id+'/publish',{method:'POST',headers:adminHeaders,body:JSON.stringify({gameVersion:created.game.questionVersion})});assert.equal(response.status,200);
  response=await fetch(origin+'/api/games/'+created.game.id+'/entries',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Persistent participant',accessKey:D.secret(),consent:true,gameVersion:created.game.questionVersion})});
  const joined=await response.json(),entryCookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,201);
  const picks=Object.fromEntries(created.game.questions.map(q=>[q.id,q.options[0].value]));
  response=await fetch(origin+'/api/entry/submit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:entryCookie,'X-CSRF-Token':joined.csrf},body:JSON.stringify({expectedRevision:0,gameVersion:created.game.questionVersion,picks,requestId:D.secret()})});assert.equal(response.status,200);
  await first.close();const second=createApplication({dbPath:file,organizerKey:KEY,now:()=>time,publicOrigin:'http://localhost:5002'});t.after(()=>{second.db.close();});
  assert.equal(second.db.prepare('SELECT title FROM (SELECT json_extract(document,\'$.title\') AS title FROM games WHERE id=?)').get(created.game.id).title,'Super Bowl test game');assert.equal(second.db.prepare('SELECT count(*) as n FROM receipts').get().n,1);assert.deepEqual(JSON.parse(second.db.prepare('SELECT submitted FROM entries').get().submitted),picks);assert.equal(second.db.prepare("SELECT count(*) as n FROM audit WHERE kind='entry_submitted'").get().n,1);
});

test('split UTF-8 request chunks preserve participant names',async t=>{
  const f=await fixture(t),g=await f.create();
  const bytes=Buffer.from(JSON.stringify({name:'Zoë',accessKey:D.secret(),consent:true,gameVersion:g.questionVersion}));
  const split=bytes.indexOf(Buffer.from('ë'))+1;
  const result=await new Promise((resolve,reject)=>{
    const req=require('node:http').request(f.origin+'/api/games/'+g.id+'/entries',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});
    req.on('error',reject);req.write(bytes.subarray(0,split));setImmediate(()=>req.end(bytes.subarray(split)));
  });
  assert.equal(result.status,201);assert.equal(result.body.entry.name,'Zoë');
});

test('rotating organizer key on restart revokes existing organizer sessions',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'organizer-rotate-')),file=path.join(directory,'shared.db');
  const first=createApplication({dbPath:file,organizerKey:KEY,publicOrigin:'http://localhost:5002'});
  first.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(D.hash(D.secret()),'admin',null,D.secret(),Date.now()+86400000);
  assert.equal(first.db.prepare("SELECT count(*) as n FROM sessions WHERE role='admin'").get().n,1);
  first.db.close();
  const second=createApplication({dbPath:file,organizerKey:KEY+'-rotated',publicOrigin:'http://localhost:5002'});
  assert.equal(second.db.prepare("SELECT count(*) as n FROM sessions WHERE role='admin'").get().n,0);
  second.db.close();fs.rmSync(directory,{recursive:true,force:true});
});
