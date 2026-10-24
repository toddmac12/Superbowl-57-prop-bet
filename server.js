'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {secret}=require('./shared/domain');
const {createApplication}=require('./shared/server');
const root=__dirname, data=path.resolve(process.env.DATA_DIR||path.join(root,'App_Data'));
fs.mkdirSync(data,{recursive:true,mode:0o700});
let key=process.env.ORGANIZER_KEY;
if(!key){const file=path.join(data,'organizer-key');try{key=fs.readFileSync(file,'utf8').trim();}catch(error){if(error.code!=='ENOENT')throw error;key=secret();fs.writeFileSync(file,key+'\n',{flag:'wx',mode:0o600});}console.log('Organizer key is stored in App_Data/organizer-key (or your configured DATA_DIR). Keep it private.');}
const port=Number(process.env.PORT||5002), publicOrigin=process.env.PUBLIC_ORIGIN||`http://localhost:${port}`;
const parsed=new URL(publicOrigin);
if(parsed.origin!==publicOrigin)throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash.');
if(process.env.NODE_ENV==='production'&&parsed.protocol!=='https:')throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.');
const app=createApplication({root,dbPath:path.join(data,'shared.db'),organizerKey:key,publicOrigin,onError:error=>console.error('Request failed:',error.name)});
app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Game app: ${publicOrigin} — Organizer: ${publicOrigin}/organizer`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
