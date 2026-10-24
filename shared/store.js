'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
function openStore(file) {
  if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(require('./schema'));
  db.exec('PRAGMA user_version=1;');
  return db;
}
function transaction(db, work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
module.exports={openStore,transaction};
