import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import handlerModule from '../shared/handler.js';
import schema from '../shared/schema.js';
import { access, secure } from './access.mjs';
import verifier from './access-verifier.mjs';

// All API requests use one object: entry/session/game transactions share one SQLite database.
export class PicksStore extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    const sql=ctx.storage.sql;
    this.ctx=ctx;
    sql.exec('CREATE TABLE IF NOT EXISTS app_access_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)');
    ctx.storage.transactionSync(()=>{
      sql.exec('PRAGMA foreign_keys=ON');
      for(const statement of schema.split(';').filter(s=>s.trim()))sql.exec(statement);
    });
    const db={
      transaction:work=>ctx.storage.transactionSync(work),
      prepare:query=>({
        get:(...args)=>sql.exec(query,...args).toArray()[0],
        all:(...args)=>sql.exec(query,...args).toArray(),
        run:(...args)=>{const cursor=sql.exec(query,...args);return {changes:cursor.rowsWritten};}
      })
    };
    this.handle=handlerModule.createHandler({db,organizerKey:env.ORGANIZER_KEY,publicOrigin:env.PUBLIC_ORIGIN});
  }
  async consumePinAttempt(key) {
    const now=Date.now(),sql=this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(()=>{
      sql.exec('DELETE FROM app_access_attempts WHERE expires <= ?',now);
      sql.exec('INSERT INTO app_access_attempts (key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1',key,now+900000);
      return sql.exec('SELECT attempts FROM app_access_attempts WHERE key=?',key).toArray()[0].attempts<=10;
    });
  }
  async fetch(request){
    // The outer Worker overwrites this header using Cloudflare's trusted client address.
    const headers=Object.fromEntries(request.headers);
    const req={url:new URL(request.url).pathname+new URL(request.url).search,method:request.method,headers,
      socket:{remoteAddress:headers['x-picks-client-ip']||'unknown'},
      async *[Symbol.asyncIterator](){
        if(!request.body)return;
        const reader=request.body.getReader();
        try{while(true){const {done,value}=await reader.read();if(done)break;yield Buffer.from(value);}}
        finally{await reader.cancel();reader.releaseLock();}
      }};
    const output=new Headers();let status=200,payload;
    const res={setHeader:(k,v)=>output.set(k,v),writeHead:(code,values)=>{status=code;for(const [k,v]of Object.entries(values))output.set(k,v);},end:value=>{payload=value;}};
    await this.handle(req,res);
    return new Response(payload,{status,headers:output});
  }
}
const files=new Set(['/index.html','/offline.html','/hosted.js','/hosted.css','/core.js','/app.js','/styles.css']);
function security(response){
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('Strict-Transport-Security','max-age=31536000');headers.set('Cache-Control','no-cache');
  return new Response(response.body,{status:response.status,headers});
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!env.PUBLIC_ORIGIN||url.origin!==env.PUBLIC_ORIGIN)return new Response('Use the configured game address.',{status:404});
    const blocked=await access(request,{
      title:'Picks App',secret:env.ORGANIZER_KEY,code:env.APP_ACCESS_CODE,
      verifier:env.APP_ACCESS_CODE?undefined:verifier,
      consume:key=>env.PICKS_STORE.get(env.PICKS_STORE.idFromName('shared-games-v1')).consumePinAttempt(key)
    });
    if(blocked)return blocked;
    if(url.pathname.startsWith('/api/')){
      if(typeof env.ORGANIZER_KEY!=='string'||env.ORGANIZER_KEY.length<32)return new Response('Organizer setup is required.',{status:503});
      const headers=new Headers(request.headers);headers.set('x-picks-client-ip',request.headers.get('CF-Connecting-IP')||'unknown');
      return secure(await env.PICKS_STORE.get(env.PICKS_STORE.idFromName('shared-games-v1')).fetch(new Request(request,{headers})));
    }
    if(!['GET','HEAD'].includes(request.method))return security(new Response('Not found',{status:404}));
    if(['/','/organizer','/entry'].includes(url.pathname)||/^\/game\/[a-f0-9-]{36}$/.test(url.pathname))url.pathname='/index.html';
    if(url.pathname==='/super-bowl.php')url.pathname='/offline.html';
    if(!files.has(url.pathname))return security(new Response('Not found',{status:404}));
    return secure(security(await env.ASSETS.fetch(new Request(url,request))));
  }
};
