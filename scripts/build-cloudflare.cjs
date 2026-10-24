'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'cloudflare','public');
fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','hosted.js','hosted.css','offline.html','core.js','app.js','styles.css'])fs.copyFileSync(path.join(root,file),path.join(out,file));
