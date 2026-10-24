'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
function openStore(file) {
  if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, status TEXT NOT NULL, document TEXT NOT NULL, question_version TEXT NOT NULL, results TEXT NOT NULL DEFAULT '{}', results_revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), name TEXT NOT NULL, name_key TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, access_expires INTEGER NOT NULL, draft TEXT NOT NULL DEFAULT '{}', submitted TEXT, revision INTEGER NOT NULL DEFAULT 0, submission_revision INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(game_id,name_key));
  CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY, role TEXT NOT NULL, entry_id TEXT REFERENCES entries(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS revisions(entry_id TEXT NOT NULL REFERENCES entries(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, picks TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(entry_id,revision));
  CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id), request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, revision INTEGER NOT NULL, accepted_at TEXT NOT NULL, UNIQUE(entry_id,request_id));
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT REFERENCES games(id), entry_id TEXT REFERENCES entries(id), kind TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
  PRAGMA user_version=1;`);
  return db;
}
function transaction(db, work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
module.exports={openStore,transaction};
