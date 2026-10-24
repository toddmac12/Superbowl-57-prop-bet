'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const D=require('./domain');
const {openStore,transaction}=require('./store');
const DAY=86400000;
const cookieNames={admin:'sb_organizer',participant:'sb_participant'};
function createApplication(options={}) {
  const root=options.root||path.resolve(__dirname,'..');
  const db=openStore(options.dbPath||path.join(root,'App_Data','shared.db'));
  const now=options.now||Date.now;
  const key=options.organizerKey;
  if(typeof key!=='string'||key.length<32)throw new Error('A private organizer key of at least 32 characters is required.');
  const organizerHash=D.hash(key);
  transaction(db,()=>{const prior=db.prepare("SELECT value FROM settings WHERE name='organizer_key_hash'").get();if(prior&&prior.value!==organizerHash)db.prepare("DELETE FROM sessions WHERE role='admin'").run();db.prepare("INSERT INTO settings(name,value) VALUES('organizer_key_hash',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(organizerHash);});
  const attempts=new Map();
  let server;
  const origin=()=>typeof options.publicOrigin==='function'?options.publicOrigin():options.publicOrigin||`http://localhost:${server.address().port}`;
  const secure=()=>new URL(origin()).protocol==='https:';
  const iso=()=>new Date(now()).toISOString();
  const getGame=id=>db.prepare('SELECT * FROM games WHERE id=?').get(id)||D.fail(404,'Game not found.');
  function documentOf(game){return JSON.parse(game.document);}
  function gameView(game,admin=false) {
    const doc=documentOf(game), revealed=now()>=Date.parse(doc.revealAt);
    return {id:game.id,status:game.status,...doc,gameYear:new Date(doc.kickoffAt).getUTCFullYear(),questionVersion:game.question_version,
      locked:now()>=Date.parse(doc.lockAt),revealed,serverTime:iso(),resultsRevision:game.results_revision,
      results:admin||revealed?JSON.parse(game.results):{},
      entryCount:db.prepare('SELECT COUNT(*) AS n FROM entries WHERE game_id=? AND submitted IS NOT NULL').get(game.id).n};
  }
  function audit(game,entry,kind,detail){db.prepare('INSERT INTO audit(game_id,entry_id,kind,detail,at) VALUES(?,?,?,?,?)').run(game,entry,kind,JSON.stringify(detail),iso());}
  function unlocked(game,time=now()){if(game.status!=='published')D.fail(409,'This game is not open.');if(time>=Date.parse(documentOf(game).lockAt))D.fail(423,'Submissions are locked. Your last accepted submission is unchanged.');}
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function session(raw,role){
    if(!D.validSecret(raw))return null;
    return db.prepare('SELECT * FROM sessions WHERE id_hash=? AND role=? AND expires>?').get(D.hash(raw),role,now())||null;
  }
  function cookies(req){const out={};for(const part of(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim();}return out;}
  function requireAuth(req,role,write=false){
    const s=session(cookies(req)[cookieNames[role]],role);
    if(!s)D.fail(401,role==='admin'?'Organizer sign-in required.':'Open your private management link to access this entry.');
    if(write&&!D.same(req.headers['x-csrf-token'],s.csrf))D.fail(403,'Refresh this page before saving (invalid security token).');
    return s;
  }
  function issueSession(res,role,entryId=null){
    const token=D.secret(), csrf=D.secret();
    const expires=now()+7*DAY;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(D.hash(token),role,entryId,csrf,expires);
    res.setHeader('Set-Cookie',`${cookieNames[role]}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure()?'; Secure':''}`);
    return csrf;
  }
  function entryView(entry){
    const game=getGame(entry.game_id), receipt=db.prepare('SELECT id,revision,accepted_at AS acceptedAt FROM receipts WHERE entry_id=? ORDER BY revision DESC LIMIT 1').get(entry.id)||null;
    return {id:entry.id,name:entry.name,game:gameView(game),revision:entry.revision,draft:JSON.parse(entry.draft),
      submitted:entry.submitted===null?null:JSON.parse(entry.submitted),submissionRevision:entry.submission_revision,receipt};
  }
  function participant(req,write=false){
    const s=requireAuth(req,'participant',write);
    const entry=db.prepare('SELECT * FROM entries WHERE id=?').get(s.entry_id);
    if(!entry||entry.access_expires<=now())D.fail(401,'This entry link has expired. Contact the organizer for a replacement.');
    return entry;
  }
  function limit(req,bucket,max){
    const token=bucket+':'+req.socket.remoteAddress;
    let item=attempts.get(token);if(!item||item.until<=now())item={n:0,until:now()+15*60000};
    item.n++;attempts.set(token,item);
    if(attempts.size>10000){for(const [k,v]of attempts)if(v.until<=now())attempts.delete(k);if(attempts.size>10000)attempts.delete(attempts.keys().next().value);}
    if(item.n>max)D.fail(429,'Too many requests. Try again later.');
  }
  async function body(req){
    if(!(req.headers['content-type']||'').startsWith('application/json'))D.fail(415,'Send JSON data.');
    if(req.headers.origin!==origin())D.fail(403,'This request must come from the game site.');
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)D.fail(413,'Request is too large.');chunks.push(chunk);}
    try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))D.fail(400,'Invalid request.');return value;}
    catch(error){if(error instanceof D.AppError)throw error;D.fail(400,'Invalid JSON.');}
  }
  const integer=(value,label)=>{if(!Number.isInteger(value)||value<0)D.fail(400,'Invalid '+label+'.');return value;};
  const checkVersion=(game,data)=>{if(data.gameVersion!==game.question_version)D.fail(409,'This form belongs to a different game/question version. Refresh before submitting.');};
  const checkRevision=(entry,data)=>{if(integer(data.expectedRevision,'entry revision')!==entry.revision)D.fail(409,'This entry changed in another tab or device. Reload before saving.');};
  const assets=new Map([
    ['/', ['index.html','text/html']],['/index.html',['index.html','text/html']],['/organizer',['index.html','text/html']],['/entry',['index.html','text/html']],
    ['/offline.html',['offline.html','text/html']],['/super-bowl.php',['offline.html','text/html']],
    ...['hosted.js','core.js','app.js'].map(p=>['/'+p,[p,'text/javascript']]),
    ...['hosted.css','styles.css'].map(p=>['/'+p,[p,'text/css']])
  ]);
  async function handle(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(secure())res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,origin()), route=url.pathname, method=req.method;
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
      if(!route.startsWith('/api/')){
        const asset=/^\/game\/[a-f0-9-]{36}$/.test(route)?['index.html','text/html']:assets.get(route);
        if(!asset||!['GET','HEAD'].includes(method))D.fail(404,'Page not found.');
        res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-cache'});
        return res.end(method==='HEAD'?undefined:fs.readFileSync(path.join(root,asset[0])));
      }
      let data=null;if(['POST','PUT','DELETE'].includes(method))data=await body(req);
      let match;
      if(method==='GET'&&route==='/api/session'){
        const c=cookies(req), a=session(c.sb_organizer,'admin'),p=session(c.sb_participant,'participant');
        return json(res,200,{organizer:a?{authenticated:true,csrf:a.csrf}:{authenticated:false},participant:p?{authenticated:true,csrf:p.csrf}:{authenticated:false},serverTime:iso()});
      }
      if(method==='POST'&&route==='/api/organizer/login'){
        limit(req,'login',10);
        if(typeof data.key!=='string'||data.key.length>1024||!D.same(D.hash(data.key),organizerHash))D.fail(401,'Invalid organizer key.');
        const old=session(cookies(req).sb_organizer,'admin');if(old)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(old.id_hash);
        return json(res,200,{csrf:issueSession(res,'admin')});
      }
      if(method==='POST'&&route==='/api/organizer/logout'){
        const s=requireAuth(req,'admin',true);db.prepare('DELETE FROM sessions WHERE id_hash=?').run(s.id_hash);
        res.setHeader('Set-Cookie',`sb_organizer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure()?'; Secure':''}`);return json(res,200,{ok:true});
      }
      if(method==='GET'&&route==='/api/games')return json(res,200,{games:db.prepare("SELECT * FROM games WHERE status='published'").all().map(g=>{const v=gameView(g);return{id:v.id,title:v.title,season:v.season,gameYear:v.gameYear,kickoffAt:v.kickoffAt,lockAt:v.lockAt,revealAt:v.revealAt,locked:v.locked,revealed:v.revealed};}).sort((a,b)=>b.kickoffAt.localeCompare(a.kickoffAt))});
      if(method==='GET'&&route==='/api/organizer/games'){
        requireAuth(req,'admin');return json(res,200,{games:db.prepare('SELECT * FROM games ORDER BY created_at DESC').all().map(g=>gameView(g,true))});
      }
      if(method==='POST'&&route==='/api/organizer/games'){
        requireAuth(req,'admin',true);const doc=D.gameInput(data),id=crypto.randomUUID(),version=D.hash(JSON.stringify(doc));
        db.prepare('INSERT INTO games(id,status,document,question_version,created_at) VALUES(?,?,?,?,?)').run(id,'draft',JSON.stringify(doc),version,iso());
        audit(id,null,'game_created',{title:doc.title});return json(res,201,{game:gameView(getGame(id),true)});
      }
      if((match=route.match(/^\/api\/organizer\/games\/([a-f0-9-]{36})$/))&&method==='PUT'){
        requireAuth(req,'admin',true);
        const result=transaction(db,()=>{const game=getGame(match[1]);if(game.status!=='draft')D.fail(409,'Published questions, rules, and times are frozen. Create a new game instead.');
          if(data.gameVersion!==game.question_version)D.fail(409,'This draft changed. Reload before editing.');
          const doc=D.gameInput(data);db.prepare('UPDATE games SET document=?,question_version=? WHERE id=?').run(JSON.stringify(doc),D.hash(JSON.stringify(doc)),game.id);audit(game.id,null,'draft_updated',{});return gameView(getGame(game.id),true);});
        return json(res,200,{game:result});
      }
      if((match=route.match(/^\/api\/organizer\/games\/([a-f0-9-]{36})\/publish$/))&&method==='POST'){
        requireAuth(req,'admin',true);
        const result=transaction(db,()=>{const game=getGame(match[1]);if(game.status!=='draft')D.fail(409,'Game already published.');checkVersion(game,data);if(Date.parse(documentOf(game).lockAt)<=now())D.fail(400,'Choose a future submission deadline before publishing.');
          db.prepare("UPDATE games SET status='published' WHERE id=?").run(game.id);audit(game.id,null,'game_published',{questionVersion:game.question_version});return gameView(getGame(game.id),true);});
        return json(res,200,{game:result,invitation:origin()+'/game/'+result.id});
      }
      if((match=route.match(/^\/api\/games\/([a-f0-9-]{36})$/))&&method==='GET'){
        const game=getGame(match[1]);if(game.status!=='published')D.fail(404,'Game not found.');return json(res,200,{game:gameView(game)});
      }
      if((match=route.match(/^\/api\/games\/([a-f0-9-]{36})\/entries$/))&&method==='POST'){
        limit(req,'register',100);if(!D.validSecret(data.accessKey))D.fail(400,'Refresh to create a secure entry link.');if(data.consent!==true)D.fail(400,'Acknowledge when your display name and submitted picks become public.');
        const name=D.text(data.name,'display name',60), normalized=D.nameKey(name), accessHash=D.hash(data.accessKey);
        const entry=transaction(db,()=>{
          const game=getGame(match[1]),doc=documentOf(game);checkVersion(game,data);
          const existing=db.prepare('SELECT * FROM entries WHERE access_hash=?').get(accessHash);
          if(existing){if(existing.game_id!==game.id||existing.name_key!==normalized||existing.access_expires<=now())D.fail(409,'This registration key was already used.');return existing;}
          unlocked(game);
          if(db.prepare('SELECT COUNT(*) AS n FROM entries WHERE game_id=?').get(game.id).n>=500)D.fail(409,'This game has reached its entry limit.');
          if(db.prepare('SELECT id FROM entries WHERE game_id=? AND name_key=?').get(game.id,normalized))D.fail(409,'That display name already has an entry. Use your private link or contact the organizer.');
          const id=crypto.randomUUID();db.prepare('INSERT INTO entries(id,game_id,name,name_key,access_hash,access_expires,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,game.id,name,normalized,accessHash,Date.parse(doc.revealAt)+90*DAY,iso(),iso());
          audit(game.id,id,'entry_created',{});return db.prepare('SELECT * FROM entries WHERE id=?').get(id);
        });
        const csrf=issueSession(res,'participant',entry.id);
        return json(res,201,{entry:entryView(entry),csrf,managementLink:origin()+'/entry#access='+data.accessKey});
      }
      if(route==='/api/access/exchange'&&method==='POST'){
        limit(req,'access',60);
        if(!D.validSecret(data.accessKey))D.fail(401,'Invalid or expired private link.');
        const entry=db.prepare('SELECT * FROM entries WHERE access_hash=? AND access_expires>?').get(D.hash(data.accessKey),now());
        if(!entry)D.fail(401,'Invalid or expired private link. Contact the organizer.');
        const old=session(cookies(req).sb_participant,'participant');if(old)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(old.id_hash);
        return json(res,200,{csrf:issueSession(res,'participant',entry.id),entry:entryView(entry)});
      }
      if(route==='/api/entry'&&method==='GET')return json(res,200,{entry:entryView(participant(req))});
      if(route==='/api/entry/draft'&&method==='PUT'){
        const authorized=participant(req,true);
        const result=transaction(db,()=>{const entry=db.prepare('SELECT * FROM entries WHERE id=?').get(authorized.id),game=getGame(entry.game_id);unlocked(game);checkVersion(game,data);checkRevision(entry,data);
          const picks=D.answers(data.picks,documentOf(game).questions),revision=entry.revision+1;
          db.prepare('UPDATE entries SET draft=?,revision=?,updated_at=? WHERE id=?').run(JSON.stringify(picks),revision,iso(),entry.id);
          db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(entry.id,revision,'draft',JSON.stringify(picks),iso());
          return entryView(db.prepare('SELECT * FROM entries WHERE id=?').get(entry.id));});
        return json(res,200,{entry:result});
      }
      if(route==='/api/entry/submit'&&method==='POST'){
        const authorized=participant(req,true);if(!D.validSecret(data.requestId))D.fail(400,'A submission request ID is required.');
        const result=transaction(db,()=>{
          const acceptedTime=now();
          const entry=db.prepare('SELECT * FROM entries WHERE id=?').get(authorized.id),game=getGame(entry.game_id);
          const picks=D.answers(data.picks,documentOf(game).questions,true),payloadHash=D.hash(JSON.stringify({picks,gameVersion:data.gameVersion,expectedRevision:data.expectedRevision}));
          const previous=db.prepare('SELECT * FROM receipts WHERE entry_id=? AND request_id=?').get(entry.id,data.requestId);
          if(previous){if(previous.payload_hash!==payloadHash)D.fail(409,'This submission request was already used for different answers.');return{receipt:{id:previous.id,revision:previous.revision,acceptedAt:previous.accepted_at},entry:entryView(entry),replayed:true};}
          unlocked(game,acceptedTime);checkVersion(game,data);checkRevision(entry,data);
          const revision=entry.revision+1,acceptedAt=new Date(acceptedTime).toISOString(),id=crypto.randomUUID();
          db.prepare('UPDATE entries SET draft=?,submitted=?,revision=?,submission_revision=?,updated_at=? WHERE id=?').run(JSON.stringify(picks),JSON.stringify(picks),revision,revision,acceptedAt,entry.id);
          db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(entry.id,revision,'submitted',JSON.stringify(picks),acceptedAt);
          db.prepare('INSERT INTO receipts(id,entry_id,request_id,payload_hash,revision,accepted_at) VALUES(?,?,?,?,?,?)').run(id,entry.id,data.requestId,payloadHash,revision,acceptedAt);
          audit(game.id,entry.id,'entry_submitted',{receipt:id,revision});
          return{receipt:{id,revision,acceptedAt},entry:entryView(db.prepare('SELECT * FROM entries WHERE id=?').get(entry.id)),replayed:false};
        });return json(res,200,result);
      }
      if((match=route.match(/^\/api\/games\/([a-f0-9-]{36})\/leaderboard$/))&&method==='GET'){
        const game=getGame(match[1]);if(game.status!=='published')D.fail(404,'Game not found.');const view=gameView(game);if(!view.revealed)return json(res,200,{revealed:false,rows:[],revealAt:view.revealAt});
        const rows=db.prepare('SELECT id,name,submitted FROM entries WHERE game_id=? AND submitted IS NOT NULL').all(game.id).map(e=>({id:e.id,name:e.name,picks:JSON.parse(e.submitted),...D.score(JSON.parse(e.submitted),view.results,view.questions)})).sort((a,b)=>b.correct-a.correct||a.name.localeCompare(b.name));
        let prior=null,rank=0;for(let i=0;i<rows.length;i++){if(rows[i].correct!==prior)rank=i+1;rows[i].rank=rank;prior=rows[i].correct;}
        return json(res,200,{revealed:true,rows,results:view.results,resultsRevision:game.results_revision});
      }
      if((match=route.match(/^\/api\/organizer\/games\/([a-f0-9-]{36})\/entries$/))&&method==='GET'){
        requireAuth(req,'admin');const game=getGame(match[1]),visible=gameView(game).revealed;
        const entries=db.prepare('SELECT id,name,revision,submitted,submission_revision,updated_at FROM entries WHERE game_id=? ORDER BY name_key').all(game.id).map(e=>({id:e.id,name:e.name,revision:e.revision,submitted:e.submitted!==null,submissionRevision:e.submission_revision,updatedAt:e.updated_at,...(visible&&e.submitted?{picks:JSON.parse(e.submitted)}:{})}));
        return json(res,200,{entries});
      }
      if((match=route.match(/^\/api\/organizer\/entries\/([a-f0-9-]{36})\/rotate$/))&&method==='POST'){
        requireAuth(req,'admin',true);const reason=D.text(data.reason,'recovery reason',500),accessKey=D.secret();
        transaction(db,()=>{const entry=db.prepare('SELECT * FROM entries WHERE id=?').get(match[1]);if(!entry)D.fail(404,'Entry not found.');
          db.prepare('UPDATE entries SET access_hash=?,access_expires=? WHERE id=?').run(D.hash(accessKey),Math.max(now(),Date.parse(documentOf(getGame(entry.game_id)).revealAt))+90*DAY,entry.id);
          db.prepare('DELETE FROM sessions WHERE entry_id=?').run(entry.id);audit(entry.game_id,entry.id,'entry_access_rotated',{reason});});
        return json(res,200,{managementLink:origin()+'/entry#access='+accessKey});
      }
      if((match=route.match(/^\/api\/organizer\/games\/([a-f0-9-]{36})\/results$/))&&method==='PUT'){
        requireAuth(req,'admin',true);const reason=D.text(data.reason,'result explanation',500);
        let source='';if(data.source){try{const u=new URL(data.source);if(!['https:','http:'].includes(u.protocol))throw 0;source=u.href;}catch{D.fail(400,'Use an HTTP(S) source URL.');}}
        const result=transaction(db,()=>{const game=getGame(match[1]);if(game.status!=='published'||now()<Date.parse(documentOf(game).lockAt))D.fail(409,'Results can be entered only after the submission deadline.');
          if(integer(data.expectedRevision,'result revision')!==game.results_revision)D.fail(409,'Results changed in another tab. Reload before saving.');
          const results=D.answers(data.results,documentOf(game).questions,false,true),revision=game.results_revision+1;
          audit(game.id,null,'results_updated',{before:JSON.parse(game.results),after:results,reason,source,status:data.final===true?'final':'provisional',revision});
          db.prepare('UPDATE games SET results=?,results_revision=? WHERE id=?').run(JSON.stringify(results),revision,game.id);return gameView(getGame(game.id),true);});
        return json(res,200,{game:result});
      }
      if((match=route.match(/^\/api\/(organizer\/)?games\/([a-f0-9-]{36})\/audit$/))&&method==='GET'){
        const game=getGame(match[2]);if(match[1])requireAuth(req,'admin');else if(game.status!=='published'||!gameView(game).revealed)D.fail(404,'Results history is not public yet.');
        const events=db.prepare("SELECT kind,detail,at FROM audit WHERE game_id=? AND kind='results_updated' ORDER BY id").all(game.id).map(e=>({kind:e.kind,...JSON.parse(e.detail),at:e.at}));return json(res,200,{events});
      }
      D.fail(404,'Endpoint not found.');
    }catch(error){json(res,error.status||500,{error:error.status?error.message:'The server could not complete this request. Try again.'});if(!error.status&&options.onError)options.onError(error);}
  }
  server=http.createServer(handle);
  return {server,db,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}
module.exports={createApplication};
