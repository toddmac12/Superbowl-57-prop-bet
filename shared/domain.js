'use strict';
const crypto = require('node:crypto');
const legacy = require('../core.js');
class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new AppError(status, message); };
function text(value, label, max=120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(400, `Enter a valid ${label} (up to ${max} characters).`);
  return value.trim();
}
const nameKey = value => text(value, 'display name', 60).normalize('NFKC').toLocaleLowerCase('en-US');
const secret = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function same(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right); }
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function answers(value, questions, complete=false, results=false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'Answers must be an object.');
  const out = {}, known = new Map(questions.map(q=>[q.id,q]));
  for (const [key, choice] of Object.entries(value)) {
    const q=known.get(key);
    if (!q || typeof choice !== 'string' || !(choice === '' || (results && choice === 'void') || q.options.some(o=>o.value === choice))) fail(400,'An answer does not match this game.');
    if (choice) out[key]=choice;
  }
  if (complete && questions.some(q=>!out[q.id])) fail(400,'Answer every question before submitting. You can save a partial draft.');
  return Object.fromEntries(questions.filter(q=>out[q.id]).map(q=>[q.id,out[q.id]]));
}
function buildQuestions(config) {
  if (!config || typeof config !== 'object') fail(400,'Game settings are required.');
  const teamA=text(config.teamA,'first team',60), teamB=text(config.teamB,'second team',60);
  if (nameKey(teamA) === nameKey(teamB)) fail(400,'Choose two different teams.');
  const p={}, t={};
  for (const key of ['qbA','qbB','receiverA','receiverA2','receiverB','receiverB2','rbA','rbB']) p[key]=text(config.players?.[key],key,80);
  const defaults={qbBtd:1.5,qbAyards:243.5,totalTd:6.5,wrAyards:72.5,qbByards:290.5,bothpoints:25,wrA2yards:64.5,wrB2yards:22.5,rbByards:48.5};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value=config.thresholds?.[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value<0.5 || value>9999.5 || (key==='bothpoints' ? !Number.isInteger(value) : value%1!==0.5)) fail(400,`Invalid ${key} threshold. Over/under thresholds must end in .5.`);
    t[key]=value;
  }
  const labels=[
    'What will be the result of the opening coin toss?',
    'Which team will lead at the end of the first quarter?',
    'Which team will reach five points or more first?',
    `${p.qbB}: over or under ${t.qbBtd} passing touchdowns?`,
    `${p.qbA}: over or under ${t.qbAyards} passing yards?`,
    `Total touchdowns scored: over or under ${t.totalTd}?`,
    'Which half will have more points? (Overtime excluded.)',
    'Will a quarterback win Super Bowl MVP?',
    'Which team will score the last points?',
    `Will ${teamA} score in every regulation quarter?`,
    'Will the total points be odd or even?',
    'Will both teams score in the first quarter?',
    `Will ${p.receiverB} score a touchdown?`,
    'Which team will make the first field goal?',
    'Which team will score first?',
    `${p.receiverA}: over or under ${t.wrAyards} receiving yards?`,
    `${p.qbB}: over or under ${t.qbByards} passing yards?`,
    `Will both teams score at least ${t.bothpoints} points?`,
    'Will both teams score in the third quarter?',
    `Will ${p.rbA} score a touchdown?`,
    `${p.receiverA2}: over or under ${t.wrA2yards} receiving yards?`,
    `${p.receiverB2}: over or under ${t.wrB2yards} receiving yards?`,
    `${p.rbB}: over or under ${t.rbByards} rushing yards?`,
    'Will any player score two or more touchdowns? Passing touchdowns do not count.',
    'Will the winning coach have Gatorade or water poured on them?'
  ];
  const questions=legacy.QUESTIONS.map((q,i)=>({id:q.id,label:labels[i],options:q.options.map(o=>o.value==='eagles'?{value:'team-a',label:teamA}:o.value==='chiefs'?{value:'team-b',label:teamB}:{...o})}));
  return {questions,config:{teamA,teamB,players:p,thresholds:t}};
}
function gameInput(value) {
  const title=text(value.title,'game title',100), season=value.season;
  if (!Number.isInteger(season) || season<1990 || season>2200) fail(400,'Enter a valid NFL season.');
  const times={};
  for (const key of ['kickoffAt','lockAt','revealAt']) {
    const raw=value[key];
    if (typeof raw!=='string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw))) fail(400,'Use a date/time with a timezone for '+key+'.');
    times[key]=new Date(raw).toISOString();
  }
  if (Date.parse(times.lockAt)>Date.parse(times.kickoffAt)) fail(400,'The submission deadline must not be after kickoff.');
  if (Date.parse(times.revealAt)<Math.max(Date.parse(times.lockAt),Date.parse(times.kickoffAt))) fail(400,'Reveal time must be at or after both kickoff and the submission deadline.');
  const built=buildQuestions(value.config);
  const rules='One point per correct settled answer; pending and void outcomes do not count. Full-game statistics include overtime; quarter questions use regulation only; highest-scoring half excludes overtime. Total touchdowns include offense, defense, and special teams. Individual touchdown questions exclude passing touchdowns. Inactive named players are void. A postponed game keeps its original submission deadline; cancelled games are void. Organizer corrections are recorded.';
  return {title,season,...times,...built,rules};
}
function score(picks,results,questions) {
  let correct=0,settled=0,voided=0;
  for (const q of questions) { if(results[q.id]==='void'){voided++;continue;} if(!results[q.id])continue;settled++;if(picks[q.id]===results[q.id])correct++; }
  return {correct,settled,voided,pending:questions.length-settled-voided};
}
module.exports={AppError,fail,text,nameKey,secret,hash,same,validSecret,answers,gameInput,score};
