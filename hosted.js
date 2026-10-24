(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const state={session:{organizer:{},participant:{}},games:[],adminGames:[],active:null,entry:null,dirty:false,entryBusy:false,clockOffset:0};
  const playerFields={qbA:'Team A quarterback',qbB:'Team B quarterback',receiverA:'Team A receiver 1',receiverA2:'Team A receiver 2',receiverB:'Team B touchdown receiver',receiverB2:'Team B receiver 2',rbA:'Team A touchdown running back',rbB:'Team B rushing running back'};
  const thresholdFields={qbBtd:['Team B QB passing touchdowns',1.5],qbAyards:['Team A QB passing yards',243.5],totalTd:['Total touchdowns',6.5],wrAyards:['Team A receiver 1 yards',72.5],qbByards:['Team B QB passing yards',290.5],bothpoints:['Both teams minimum points',25],wrA2yards:['Team A receiver 2 yards',64.5],wrB2yards:['Team B receiver 2 yards',22.5],rbByards:['Team B running back rushing yards',48.5]};
  function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function tell(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
  function view(id){for(const name of ['home','login','organizer','game','entry'])$(name+'-view').hidden=name!==id;}
  function random(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function remember(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
  function recalled(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
  function forget(key){try{sessionStorage.removeItem(key);}catch{}}
  function clock(data){const t=data.serverTime||data.game?.serverTime||data.entry?.game?.serverTime;if(t)state.clockOffset=Date.parse(t)-Date.now();}
  async function api(url,method='GET',data,role){
    const headers={};if(data!==undefined)headers['Content-Type']='application/json';
    if(role){const session=role==='admin'?state.session.organizer:state.session.participant;if(session.csrf)headers['X-CSRF-Token']=session.csrf;}
    const response=await fetch(url,{method,headers,credentials:'same-origin',...(data===undefined?{}:{body:JSON.stringify(data)})});
    const result=await response.json();if(!response.ok){const error=new Error(result.error||'Request failed.');error.status=response.status;throw error;}clock(result);return result;
  }
  async function act(work,button){const entryAction=button&&['save-entry','submit-entry','reload-entry'].includes(button.id);if(entryAction&&state.entryBusy)return;if(entryAction){state.entryBusy=true;updateLock();}if(button)button.disabled=true;try{await work();}catch(error){tell(error.message,true);}finally{if(entryAction)state.entryBusy=false;if(button)button.disabled=false;updateLock();}}
  function when(iso){return new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}
  function times(game){return `Kickoff: ${when(game.kickoffAt)} · Picks lock: ${when(game.lockAt)} · Public reveal: ${when(game.revealAt)}. Times shown in your local timezone.`;}
  function localInput(value){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  function questionControls(container,questions,picks={},results=false,disabled=false){
    container.replaceChildren();
    for(const [index,q]of questions.entries()){
      const card=el('div',undefined,'question'),label=el('label',`${index+1}. ${q.label}`),select=document.createElement('select');
      select.id=container.id+'-'+q.id;select.name=q.id;label.htmlFor=select.id;
      select.append(new Option(results?'Pending':'Choose an answer…',''));
      for(const o of q.options)select.append(new Option(o.label,o.value));
      if(results)select.append(new Option('Void / not applicable','void'));
      select.value=picks[q.id]||'';select.disabled=disabled;card.append(label,select);container.append(card);
    }
  }
  function readAnswers(container){return Object.fromEntries([...container.querySelectorAll('select')].filter(s=>s.value).map(s=>[s.name,s.value]));}
  function linkField(container,label,url){container.replaceChildren(el('label',label));const input=document.createElement('input');input.readOnly=true;input.value=url;input.setAttribute('aria-label',label);container.append(input);}
  function renderHome(){
    view('home');const selected=$('year-filter').value, years=[...new Set(state.games.map(g=>g.gameYear))];
    $('year-filter').replaceChildren(new Option('All years','all'));for(const year of years)$('year-filter').append(new Option(String(year),String(year)));
    $('year-filter').value=years.some(y=>String(y)===selected)?selected:'all';
    $('game-list').replaceChildren();
    for(const game of state.games.filter(g=>$('year-filter').value==='all'||String(g.gameYear)===$('year-filter').value)){
      const card=el('article',undefined,'game-card'),a=el('a',game.locked?'View game':'Enter your picks','button');a.href='/game/'+game.id;
      card.append(el('p',`${game.gameYear} Super Bowl · NFL ${game.season} season`,'eyebrow'),el('h2',game.title),el('p','Deadline: '+when(game.lockAt)),a);$('game-list').append(card);
    }
    if(!$('game-list').children.length)$('game-list').append(el('p','No published games for this year yet. The organizer can create one.'));
  }
  async function loadHome(){state.games=(await api('/api/games')).games;renderHome();tell('Choose a game or open your invitation link.');}
  function buildSettings(){
    for(const [key,label]of Object.entries(playerFields)){
      const wrap=el('div'),input=document.createElement('input'),lab=el('label',label);input.id='player-'+key;input.maxLength=80;input.required=true;lab.htmlFor=input.id;wrap.append(lab,input);$('player-fields').append(wrap);
    }
    for(const [key,[label,value]]of Object.entries(thresholdFields)){
      const wrap=el('div'),input=document.createElement('input'),lab=el('label',label);input.id='threshold-'+key;input.type='number';input.min=key==='bothpoints'?'1':'0.5';input.max='9999.5';input.step=key==='bothpoints'?'1':'1';input.value=String(value);input.required=true;lab.htmlFor=input.id;wrap.append(lab,input);$('threshold-fields').append(wrap);
    }
  }
  function settingsPayload(){return{title:$('game-title').value,season:Number($('season').value),kickoffAt:new Date($('kickoff').value).toISOString(),lockAt:new Date($('lock-time').value).toISOString(),revealAt:new Date($('reveal-time').value).toISOString(),config:{teamA:$('team-a').value,teamB:$('team-b').value,players:Object.fromEntries(Object.keys(playerFields).map(key=>[key,$('player-'+key).value])),thresholds:Object.fromEntries(Object.keys(thresholdFields).map(key=>[key,Number($('threshold-'+key).value)]))},...(state.active?{gameVersion:state.active.questionVersion}:{})};}
  function displaySettings(game){
    state.active=game||null;const form=$('game-settings');form.reset();
    $('game-title').value=game?.title||'';$('season').value=game?.season||(new Date().getMonth()<6?new Date().getFullYear()-1:new Date().getFullYear());
    for(const [id,key]of [['kickoff','kickoffAt'],['lock-time','lockAt'],['reveal-time','revealAt']])$(id).value=game?localInput(game[key]):'';
    $('team-a').value=game?.config.teamA||'';$('team-b').value=game?.config.teamB||'';
    for(const key of Object.keys(playerFields))$('player-'+key).value=game?.config.players[key]||'';
    for(const [key,[,value]]of Object.entries(thresholdFields))$('threshold-'+key).value=String(game?.config.thresholds[key]??value);
    const frozen=game?.status==='published';for(const control of form.querySelectorAll('input,button'))control.disabled=Boolean(frozen);
    $('settings-title').textContent=game?game.title+(frozen?' — published and frozen':' — draft'):'Create game';
    $('publish-game').hidden=!game||frozen;$('invitation').hidden=!frozen;
    if(frozen){$('invitation-link').value=location.origin+'/game/'+game.id;$('open-game').href='/game/'+game.id;}
    const review=$('game-review');review.replaceChildren();
    if(game){review.append(el('h3','Review the frozen question set'),el('p',times(game)),el('p',game.rules,'rules'));
      const list=el('ol');for(const q of game.questions)list.append(el('li',q.label+' — '+q.options.map(o=>o.label).join(' / ')));review.append(list);}
    $('entries-panel').hidden=!frozen;$('results-panel').hidden=!frozen;$('recovery-link').replaceChildren();
    if(frozen){questionControls($('result-questions'),game.questions,game.results,true);$('results-form').querySelector('button').disabled=!game.locked;}
  }
  async function loadAdmin(selectedId=state.active?.id||''){
    view('organizer');state.adminGames=(await api('/api/organizer/games')).games;
    $('organizer-game').replaceChildren(new Option('Create a new game',''));
    for(const game of state.adminGames)$('organizer-game').append(new Option(`${game.gameYear} · ${game.title} (${game.status})`,game.id));
    $('organizer-game').value=selectedId;
    displaySettings(state.adminGames.find(g=>g.id===selectedId));if(state.active?.status==='published')await loadAdminEntries();
  }
  async function loadAdminEntries(){
    const entries=(await api('/api/organizer/games/'+state.active.id+'/entries')).entries,box=$('organizer-entries');box.replaceChildren();
    if(!entries.length)box.append(el('p','No entries yet.'));
    for(const entry of entries){
      const row=el('div',undefined,'entry-row'),button=el('button','Issue replacement private link','secondary');button.type='button';
      row.append(el('strong',entry.name),el('p',entry.submitted?'Submitted · accepted revision '+entry.submissionRevision:'Draft only — not submitted'),button);
      button.addEventListener('click',()=>act(async()=>{const reason=prompt('Explain how you verified this participant before replacing their private link.');if(!reason)return;
        if(!confirm('Replace '+entry.name+"'s private link and revoke their old link and sessions?"))return;
        const data=await api('/api/organizer/entries/'+entry.id+'/rotate','POST',{reason},'admin');linkField($('recovery-link'),'Replacement private link — share only with the verified participant',data.managementLink);tell('Old access revoked. Submitted picks were not changed.');},button));
      box.append(row);
    }
  }
  async function renderLeaderboard(game){
    const data=await api('/api/games/'+game.id+'/leaderboard'),box=$('public-leaderboard');box.replaceChildren();
    if(!data.revealed){box.append(el('p','Names and submitted picks remain private until '+when(game.revealAt)+'.'));return;}
    if(!data.rows.length){box.append(el('p','No submitted entries.'));return;}
    const table=el('table'),head=el('tr');for(const label of ['Rank','Participant','Correct'])head.append(el('th',label));table.append(head);
    for(const row of data.rows){const tr=el('tr');tr.append(el('td',String(row.rank)));const name=el('td'),details=el('details'),summary=el('summary',row.name),list=el('ol');
      for(const q of game.questions)list.append(el('li',q.label+' — '+(q.options.find(o=>o.value===row.picks[q.id])?.label||'Unanswered')));
      details.append(summary,list);name.append(details);tr.append(name,el('td',row.correct+' / '+row.settled));table.append(tr);}box.append(table);
  }
  async function loadGame(id){
    const game=(await api('/api/games/'+id)).game;state.active=game;view('game');
    $('public-title').textContent=game.title;$('game-season').textContent=`${game.gameYear} Super Bowl · NFL ${game.season} season`;
    $('public-times').textContent=times(game);$('public-rules').textContent=game.rules;$('join-panel').hidden=game.locked;
    await renderLeaderboard(game);const history=$('public-results');history.replaceChildren();
    const refresh=el('button','Refresh published results','secondary');refresh.type='button';refresh.addEventListener('click',()=>act(()=>loadGame(id),refresh));history.append(refresh);
    if(game.revealed){const outcomes=el('ol');for(const q of game.questions){const value=game.results[q.id],label=value==='void'?'Void / not applicable':q.options.find(o=>o.value===value)?.label||'Pending';outcomes.append(el('li',q.label+' — '+label));}history.append(outcomes);const audit=(await api('/api/games/'+id+'/audit')).events;for(const event of audit){const block=el('div');block.append(el('p',`${when(event.at)} · Revision ${event.revision} · ${event.status}`),el('p',event.reason));
      if(event.source){const source=el('a','Source');source.href=event.source;source.rel='noopener noreferrer';source.target='_blank';block.append(source);}history.append(block);}
      if(!audit.length)history.append(el('p','No results published yet.'));
    }else history.append(el('p','Results will be shown at the public reveal time.'));
    tell(game.locked?'Submissions are closed.':'This game is open. Keep your private link after joining.');
  }
  function renderEntry(entry){
    state.entry=entry;state.dirty=false;view('entry');$('entry-title').textContent=entry.name+' — '+entry.game.title;
    $('entry-times').textContent=times(entry.game);$('entry-rules').textContent=entry.game.rules;
    const locked=entry.game.locked||Date.now()+state.clockOffset>=Date.parse(entry.game.lockAt);
    questionControls($('entry-questions'),entry.game.questions,locked?(entry.submitted||entry.draft):entry.draft,false,locked);
    const receipt=$('receipt');receipt.replaceChildren();
    if(entry.receipt){receipt.classList.add('receipt');receipt.append(el('h2','Submission accepted'),el('p','Receipt: '+entry.receipt.id),el('p','Accepted: '+when(entry.receipt.acceptedAt)+' · Revision '+entry.receipt.revision));}
    else{receipt.classList.remove('receipt');receipt.append(el('h2','Not submitted yet'),el('p','A saved draft is not an accepted submission. Complete every question and submit.'));}
    const draftDiff=entry.submitted&&JSON.stringify(entry.draft)!==JSON.stringify(entry.submitted);
    $('entry-state').textContent=locked?'Entry locked. Only the last accepted submission counts.':draftDiff?'Draft changes are not submitted. Your earlier accepted picks still count.':'You may save drafts or submit revised picks before the deadline.';
    updateLock();
  }
  function updateLock(){
    if(!state.entry)return;const locked=Date.now()+state.clockOffset>=Date.parse(state.entry.game.lockAt);
    $('save-entry').disabled=locked||state.entryBusy;$('submit-entry').disabled=locked||state.entryBusy;$('reload-entry').disabled=state.entryBusy;
    for(const select of $('entry-questions').querySelectorAll('select'))select.disabled=locked||state.entryBusy;
    if(locked)$('entry-state').textContent='Entry locked. Only your last accepted submission counts.';
  }
  async function loadEntry(){const data=await api('/api/entry');forget('submit-entry:'+data.entry.id);renderEntry(data.entry);tell(data.entry.game.locked?'Viewing your locked entry.':'Entry loaded. Keep your private management link.');}
  function submissionPayload(){return{expectedRevision:state.entry.revision,gameVersion:state.entry.game.questionVersion,picks:readAnswers($('entry-questions'))};}
  buildSettings();
  $('year-filter').addEventListener('change',renderHome);
  $('login-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{const data=await api('/api/organizer/login','POST',{key:$('organizer-key').value});$('organizer-key').value='';state.session.organizer={authenticated:true,csrf:data.csrf};await loadAdmin();tell('Organizer signed in.');},event.submitter);});
  $('logout').addEventListener('click',()=>act(async()=>{await api('/api/organizer/logout','POST',{},'admin');state.session.organizer={authenticated:false};view('login');tell('Signed out.');},$('logout')));
  $('organizer-game').addEventListener('change',()=>act(async()=>{displaySettings(state.adminGames.find(g=>g.id===$('organizer-game').value));if(state.active?.status==='published')await loadAdminEntries();}));
  $('game-settings').addEventListener('submit',event=>{event.preventDefault();act(async()=>{const updating=state.active?.status==='draft';const data=await api('/api/organizer/games'+(updating?'/'+state.active.id:''),updating?'PUT':'POST',settingsPayload(),'admin');await loadAdmin(data.game.id);tell('Draft game saved. Review all questions, then publish.');},event.submitter);});
  $('publish-game').addEventListener('click',()=>act(async()=>{if(!confirm('Publish this game? Questions, thresholds, rules, and times become permanently frozen.'))return;const data=await api('/api/organizer/games/'+state.active.id+'/publish','POST',{gameVersion:state.active.questionVersion},'admin');await loadAdmin(data.game.id);tell('Game published. Share its invitation link.');},$('publish-game')));
  $('join-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
    const storageKey='create-entry:'+state.active.id;let pending=recalled(storageKey);
    if(!pending||pending.name!==$('display-name').value)pending={name:$('display-name').value,accessKey:random()};remember(storageKey,pending);
    const data=await api('/api/games/'+state.active.id+'/entries','POST',{...pending,consent:$('public-consent').checked,gameVersion:state.active.questionVersion});
    state.session.participant={authenticated:true,csrf:data.csrf};$('management-link').value=data.managementLink;$('created-entry').hidden=false;$('join-panel').hidden=true;forget(storageKey);tell('Private entry created. Save your management link before continuing.');
  },event.submitter);});
  $('entry-questions').addEventListener('change',()=>{state.dirty=true;});
  $('save-entry').addEventListener('click',()=>act(async()=>{const data=await api('/api/entry/draft','PUT',submissionPayload(),'participant');renderEntry(data.entry);tell('Draft saved. It does not count until submitted.');},$('save-entry')));
  $('entry-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
    const key='submit-entry:'+state.entry.id;let pending=recalled(key);if(pending&&JSON.stringify(pending.picks)!==JSON.stringify(readAnswers($('entry-questions')))&&!confirm('A prior submission is awaiting confirmation. Retry its original picks? Current unsaved changes will not be submitted. Use Reload to check the server instead.'))return;if(!pending){pending={...submissionPayload(),requestId:random()};remember(key,pending);}
    try {const data=await api('/api/entry/submit','POST',pending,'participant');forget(key);renderEntry(data.entry);tell('Submission accepted. Keep the receipt above.');}
    catch(error){if(error.status&&error.status<500)forget(key);throw error;}
  },event.submitter||$('submit-entry'));});
  $('reload-entry').addEventListener('click',()=>act(async()=>{if(state.dirty&&!confirm('Discard unsaved form edits and reload the server entry?'))return;await loadEntry();},$('reload-entry')));
  $('results-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{const data=await api('/api/organizer/games/'+state.active.id+'/results','PUT',{expectedRevision:state.active.resultsRevision,results:readAnswers($('result-questions')),reason:$('result-reason').value,source:$('result-source').value,final:$('results-final').checked},'admin');await loadAdmin(data.game.id);tell('Results saved with an audit revision.');},event.submitter);});
  async function boot(){
    const path=location.pathname;let accessKey=null;
    if(path==='/entry'){accessKey=new URLSearchParams(location.hash.slice(1)).get('access');if(location.hash)history.replaceState(null,'','/entry');}
    state.session=await api('/api/session');
    if(path==='/entry'){
      if(accessKey){const data=await api('/api/access/exchange','POST',{accessKey});state.session.participant={authenticated:true,csrf:data.csrf};renderEntry(data.entry);tell('Private link accepted.');}
      else await loadEntry();
    }else if(path==='/organizer'){
      if(state.session.organizer.authenticated){await loadAdmin();tell('Organizer dashboard ready.');}else{view('login');tell('Enter the server organizer key.');}
    }else if(/^\/game\/[a-f0-9-]{36}$/.test(path))await loadGame(path.split('/').pop());
    else await loadHome();
  }
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  setInterval(updateLock,1000);
  boot().catch(error=>{view('entry');$('entry-title').textContent='Entry access needed';$('entry-form').hidden=true;$('receipt').textContent='Open your saved private management link. If it is lost or expired, contact the organizer for a replacement.';tell(error.message,true);});
})();
