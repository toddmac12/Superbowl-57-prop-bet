'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {createApplication}=require('../shared/server');
const D=require('../shared/domain');
const KEY='organizer-test-key-with-more-than-32-characters';
const root=path.resolve(__dirname,'..');
function config(){const now=Date.now();return{title:'UI game',season:2026,kickoffAt:new Date(now+3*3600000).toISOString(),lockAt:new Date(now+2*3600000).toISOString(),revealAt:new Date(now+3*3600000).toISOString(),config:{teamA:'Team A',teamB:'Team B',players:{qbA:'QB A',qbB:'QB B',receiverA:'WR A',receiverA2:'WR A2',receiverB:'WR B',receiverB2:'WR B2',rbA:'RB A',rbB:'RB B'},thresholds:{}}};}
async function waitFor(check){const until=Date.now()+3000;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for UI condition');}
async function setup(t){
  let origin='';const app=createApplication({root,dbPath:':memory:',organizerKey:KEY,publicOrigin:()=>origin,onError:e=>{throw e;}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;t.after(()=>app.close());
  function client(){const jar=new Map();return{jar,csrf:'',async request(method,uri,data,headers={}){
    const response=await fetch(origin+uri,{method,headers:{...(jar.size?{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(this.csrf?{'X-CSRF-Token':this.csrf}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    const parsed=await response.json();if(parsed.csrf)this.csrf=parsed.csrf;return{status:response.status,data:parsed};
  }};}
  const admin=client();await admin.request('POST','/api/organizer/login',{key:KEY});let r=await admin.request('POST','/api/organizer/games',config());let game=r.data.game;
  r=await admin.request('POST','/api/organizer/games/'+game.id+'/publish',{gameVersion:game.questionVersion});game=r.data.game;
  const person=client(),accessKey=D.secret();r=await person.request('POST','/api/games/'+game.id+'/entries',{name:'UI participant',accessKey,consent:true,gameVersion:game.questionVersion});
  return{app,origin,admin,person,game,accessKey,entry:r.data.entry,client};
}
async function page(t,f,uri='/entry',cookieClient=f.person,hook){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:f.origin+uri,runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());w.confirm=()=>true;w.prompt=()=>null;
  const calls=[];w.fetch=async(url,options={})=>{
    calls.push({url,hash:w.location.hash,method:options.method||'GET'});if(hook)await hook(url,options);
    const response=await fetch(new URL(url,f.origin),{...options,headers:{...options.headers,Origin:f.origin,...(cookieClient.jar.size?{Cookie:[...cookieClient.jar].map(([k,v])=>k+'='+v).join('; ')}:{})}});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookieClient.jar.set(pair.slice(0,i),pair.slice(i+1));}
    return response;
  };
  w.eval(fs.readFileSync(path.join(root,'hosted.js'),'utf8'));
  const get=id=>w.document.getElementById(id),fill=()=>{for(const s of get('entry-questions').querySelectorAll('select')){s.value=s.options[1].value;s.dispatchEvent(new w.Event('change',{bubbles:true}));}},submit=()=>get('entry-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return{w,get,fill,submit,calls};
}

test('private link fragment is removed before fetch and entry is loaded through a scoped cookie',async t=>{
  const f=await setup(t),fresh=f.client(),p=await page(t,f,'/entry#access='+f.accessKey,fresh);
  await waitFor(()=>p.get('entry-questions').querySelectorAll('select').length===25);
  assert.equal(p.w.location.hash,'');assert.ok(p.calls.every(call=>!call.hash&&!call.url.includes(f.accessKey)));assert.match(p.get('entry-title').textContent,/UI participant/);
});

test('incomplete submission can be corrected and submitted without stale retry payload',async t=>{
  const f=await setup(t),p=await page(t,f);await waitFor(()=>p.get('entry-questions').querySelectorAll('select').length===25);
  p.submit();await waitFor(()=>p.get('notice').textContent.includes('Answer every question'));
  assert.equal(p.w.sessionStorage.getItem('submit-entry:'+f.entry.id),null);
  p.fill();p.submit();await waitFor(()=>p.get('notice').textContent.includes('Submission accepted'));
  assert.ok(p.get('receipt').textContent.includes('Receipt:'));assert.equal(f.app.db.prepare('SELECT count(*) as n FROM receipts').get().n,1);
});

test('stale revision rejection followed by reload allows a new valid submission',async t=>{
  const f=await setup(t),p=await page(t,f);await waitFor(()=>p.get('entry-questions').querySelectorAll('select').length===25);
  await f.person.request('PUT','/api/entry/draft',{expectedRevision:0,gameVersion:f.game.questionVersion,picks:{'coin-toss':'tails'}});
  p.fill();p.submit();await waitFor(()=>p.get('notice').textContent.includes('changed in another tab'));
  assert.equal(p.w.sessionStorage.getItem('submit-entry:'+f.entry.id),null);
  p.get('reload-entry').click();await waitFor(()=>p.get('entry-questions').querySelector('select')?.value==='tails');
  p.fill();p.submit();await waitFor(()=>p.get('notice').textContent.includes('Submission accepted'));
});

test('entry controls stay disabled during in-flight writes even after deadline timer ticks',async t=>{
  const f=await setup(t);let release;const pending=new Promise(r=>{release=r;});
  const p=await page(t,f,'/entry',f.person,(url)=>url==='/api/entry/draft'?pending:undefined);
  await waitFor(()=>p.get('entry-questions').querySelectorAll('select').length===25);p.fill();p.get('save-entry').click();
  await new Promise(r=>setTimeout(r,1100));assert.equal(p.get('save-entry').disabled,true);assert.equal(p.get('submit-entry').disabled,true);assert.equal(p.get('reload-entry').disabled,true);assert.ok([...p.get('entry-questions').querySelectorAll('select')].every(s=>s.disabled));
  release();await waitFor(()=>p.get('notice').textContent.includes('Draft saved'));assert.equal(p.get('save-entry').disabled,false);
});

test('invitation creates a private entry and clearly presents the management link',async t=>{
  const f=await setup(t),fresh=f.client(),p=await page(t,f,'/game/'+f.game.id,fresh);
  await waitFor(()=>p.get('public-title').textContent==='UI game');p.get('display-name').value='Second participant';p.get('public-consent').checked=true;
  p.get('join-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!p.get('created-entry').hidden);
  assert.ok(p.get('management-link').value.startsWith(f.origin+'/entry#access='));assert.ok(p.get('join-panel').hidden);assert.equal(f.app.db.prepare('SELECT count(*) as n FROM entries').get().n,2);
});

test('organizer credentials are separate and login reaches dashboard',async t=>{
  const f=await setup(t),fresh=f.client(),p=await page(t,f,'/organizer',fresh);await waitFor(()=>!p.get('login-view').hidden);
  p.get('organizer-key').value=KEY;p.get('login-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>!p.get('organizer-view').hidden&&p.get('organizer-game').options.length===2);
  assert.equal(p.get('organizer-key').value,'');assert.ok(p.get('player-fields').querySelectorAll('input').length===8);
});

test('lost response retries the accepted submission without creating another receipt',async t=>{
  const f=await setup(t),p=await page(t,f);await waitFor(()=>p.get('entry-questions').querySelectorAll('select').length===25);
  const original=p.w.fetch;let lose=true;
  p.w.fetch=async(url,options)=>{const response=await original(url,options);if(url==='/api/entry/submit'&&lose){lose=false;throw new TypeError('Response lost');}return response;};
  p.fill();p.submit();await waitFor(()=>p.get('notice').textContent.includes('Response lost'));assert.ok(p.w.sessionStorage.getItem('submit-entry:'+f.entry.id));
  p.submit();await waitFor(()=>p.get('notice').textContent.includes('Submission accepted'));assert.equal(f.app.db.prepare('SELECT count(*) as n FROM receipts').get().n,1);assert.equal(p.w.sessionStorage.getItem('submit-entry:'+f.entry.id),null);
});
