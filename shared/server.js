'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {openStore,transaction}=require('./store');
const {createHandler}=require('./handler');
function createApplication(options={}) {
  const root=options.root||path.resolve(__dirname,'..');
  const db=openStore(options.dbPath||path.join(root,'App_Data','shared.db'));
  db.transaction=work=>transaction(db,work);
  let server;
  const handle=createHandler({...options,db,
    publicOrigin:()=>typeof options.publicOrigin==='function'?options.publicOrigin():options.publicOrigin||`http://localhost:${server.address().port}`,
    readAsset:file=>fs.readFileSync(path.join(root,file))});
  server=http.createServer(handle);
  return {server,db,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}
module.exports={createApplication};
