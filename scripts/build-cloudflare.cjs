'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'cloudflare','public');
fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','hosted.js','hosted.css','offline.html','core.js','app.js','styles.css'])fs.copyFileSync(path.join(root,file),path.join(out,file));

const htmlPath=path.join(out,'index.html');fs.writeFileSync(htmlPath,fs.readFileSync(htmlPath,'utf8').replace('</head>','<script src="/_access/client.js" defer></script><link rel="stylesheet" href="/_access/client.css"></head>'));
