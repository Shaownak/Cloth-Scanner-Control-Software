import { MODE } from '/mode.js';
import { CLASSIFICATIONS, parseJSON } from '/protocol.js';
import {normalizeESPConfig,espHeader} from '/esp-config.js';
import {initFirmwareUI} from '/firmware-ui.js';
const live=MODE==='live';
const $=id=>document.getElementById(id);
let token=live ? sessionStorage.getItem('selvedge-operator') || '' : '';
let snapshot=null, view='overview', importName='Pasted JSON', busy=false, timer=null, toastTimer, firmwareUI=null;
const sim={paused:true,display_ms:3000,counts:{good:0,defected:0,repairable:0},total:0,history:[],queue:[],events:[],active:null,device:{online:true,output:'off',device_id:'virtual-esp32'},nextId:1};
function event(message){sim.events.unshift({at:Date.now(),message});sim.events=sim.events.slice(0,30);}
function notify(message,error=false){$('toast').textContent=message;$('toast').classList.remove('hidden');$('toast').classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4500);}
function banner(message,error=false){$('banner').textContent=message;$('banner').classList.toggle('hidden',!message);$('banner').classList.toggle('error',error);}
async function api(route,options={}){
  const response=await fetch(route,{...options,headers:{Authorization:`Bearer ${token}`,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(4500)});
  const data=await response.json();
  if(!response.ok){const e=new Error(data.error || 'Request failed.');e.status=response.status;throw e;}return data;
}
function stamp(at){return at?new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';}
function simSnapshot(){return {...sim,states:{pending:sim.queue.length,completed:sim.history.filter(x=>x.state==='completed').length},device:{...sim.device,online:true},server_time:Date.now()};}
function drawOutput(output){
  for(const color of ['red','yellow','green']) $(color+'Lamp').classList.toggle('lit',CLASSIFICATIONS[output]?.color===color);
  for(const status of ['defected','repairable','good']) $(CLASSIFICATIONS[status].color+'Label').classList.toggle('active',status===output);
  const info=CLASSIFICATIONS[output];
  $('signalName').textContent=info?.label || 'Standby';
  $('signalDescription').textContent=info?.description || 'All lights are off. Awaiting inspection.';
  $('signalName').parentElement.className='signal-readout '+(output || 'off');
  $('outputCode').textContent=info?`CODE ${info.code}`:'CODE —';
  $('towerDot').classList.toggle('on',!!info);
}
function createCell(text){const cell=document.createElement('td');cell.textContent=text;return cell;}
function rows(target,items){
  const body=$(target);body.replaceChildren();
  if(!items.length){const tr=document.createElement('tr');const td=createCell(live?'Waiting for the AI server to send the first cloth result.':'No inspections yet. Upload JSON to get started.');td.colSpan=5;td.className='empty-row';tr.append(td);body.append(tr);return;}
  for(const item of items){const tr=document.createElement('tr');tr.dataset.id=String(item.id);tr.tabIndex=0;tr.title='View inspection details';
    tr.append(createCell(item.cloth_id));
    const statusCell=document.createElement('td'),chip=document.createElement('span');chip.className=`status-chip ${item.status}`;chip.textContent=CLASSIFICATIONS[item.status].label;statusCell.append(chip);tr.append(statusCell);
    tr.append(createCell(`${CLASSIFICATIONS[item.status].color} · ${CLASSIFICATIONS[item.status].code}`));
    const progress=item.state==='active' ? item.acknowledged_at ? (live?'ESP reported output':'Displaying') : 'Awaiting ESP' : ({pending:'Queued',completed:'Completed',interrupted:'Interrupted',cancelled:'Cancelled'}[item.state] || item.state);
    tr.append(createCell(progress),createCell(stamp(item.created_at)));body.append(tr);
  }
}
function render(){
  snapshot=live ? snapshot : simSnapshot();if(!snapshot)return;
  const s=snapshot,device=s.device,online=device.online;
  $('totalCount').textContent=s.total;for(const status of ['good','defected','repairable']) $(status+'Count').textContent=s.counts[status] || 0;
  $('queueCount').textContent=`${s.states.pending || 0} queued`;
  $('runButton').textContent=live?'▶ Start line':'▶ Start playback';
  $('runButton').disabled=!s.paused || (live&&!online) || (!live&&!s.queue.length);
  $('pauseButton').disabled=s.paused; $('clearButton').disabled=!s.paused || !s.queue.length;
  if(document.activeElement!==$('duration'))$('duration').value=String(s.display_ms);
  $('deviceBadge').textContent=live?(online?'● ESP32 connected':'○ ESP32 offline'):'No hardware needed';
  $('deviceBadge').className=`connection ${live?(online?'online':'offline'):''}`;
  const output=online?device.output:'off'; drawOutput(output);
  if(live&&!online){$('signalName').textContent='No connection';$('signalDescription').textContent='Output state unconfirmed. ESP32 timeout turns lights off.';}
  $('tableScene').classList.toggle('running',!!s.active&&!s.paused);
  $('tableStatus').textContent=s.paused?'Paused':s.active?'Inspecting':'Ready';
  $('tableStatus').classList.toggle('active',!s.paused&&!!s.active);
  const last=s.active || s.history[0];
  $('sceneCloth').textContent=last?last.cloth_id:'Waiting for a cloth result';
  $('sceneStatus').textContent=s.active?`CODE ${CLASSIFICATIONS[s.active.status].code} / ${s.active.status.toUpperCase()}`:live?'LISTENING FOR AI':'READY FOR JSON';
  // This marker illustrates the category, not a measured defect coordinate.
  $('defectMarker').classList.toggle('hidden',!s.active || s.active.status!=='defected');
  $('inputStep').textContent=s.total?`${s.total} results received`:live?'Listening to AI server':'Upload a result';
  $('processStep').textContent=s.active?s.active.acknowledged_at?'Output reported':'Command sent':s.paused?'Line paused':'Waiting for input';
  $('outputStep').textContent=CLASSIFICATIONS[output]?`${CLASSIFICATIONS[output].color} signal active`:online?'All outputs off':'State unconfirmed';
  rows('recentRows',s.history.slice(0,5));
  const filter=$('historyFilter').value;rows('historyRows',s.history.filter(x=>filter==='all'||x.status===filter));
  $('eventList').replaceChildren();for(const entry of s.events){const row=document.createElement('div');row.className='event-row';const time=document.createElement('time');time.textContent=stamp(entry.at);const text=document.createElement('span');text.textContent=entry.message;row.append(time,text);$('eventList').append(row);}
  $('setupDevice').textContent=device.device_id;
  $('setupConnection').textContent=live?(online?'Connected · reporting GPIO output state':'Offline · waiting for ESP32 reports'):'Simulation · no physical device';
  $('firmwareVersion').textContent=live?device.firmware || 'Not reported':'Virtual controller';
  $('rssi').textContent=device.rssi!==undefined&&device.rssi!==null?`${device.rssi} dBm`:'—';
  $('lastSeen').textContent=stamp(device.last_seen);$('serverAddress').textContent=live?location.origin:'Simulation only';
  if(live){const v=s.vision || {};$('visionState').textContent=v.heartbeat_online===true?'AI sender connected':v.heartbeat_online===false?'Heartbeat overdue':v.last_seen&&s.server_time-v.last_seen<15000?'Receiving results':'Waiting for AI';$('visionState').classList.toggle('active',v.heartbeat_online===true);$('visionCloth').textContent=v.last_cloth_id || '—';$('visionTime').textContent=stamp(v.last_result_at);$('visionPending').textContent=`${s.states.pending || 0} cloths`;$('visionHint').textContent=v.oldest_pending_ms>10000?`Oldest waiting cloth: ${Math.floor(v.oldest_pending_ms/1000)} seconds. Check line state and signal duration.`:'Every result is received automatically and displayed in order.';}
  if(live)banner(!online?'ESP32 is offline. Connect and configure the board in Device & setup. Results can still be queued.':s.paused?'The line is paused. Select Start line when the table is ready.':'');
}
async function refresh(){if(!token)return;try{snapshot=await api('/api/overview');render();}catch(e){if(e.status===401){token='';sessionStorage.removeItem('selvedge-operator');if(!$('loginDialog').open)$('loginDialog').showModal();}else{if(snapshot){snapshot.device.online=false;render();}banner('Cannot reach the controller. Reconnecting automatically. Output state is unconfirmed.',true);}}}
async function poll(){await refresh();setTimeout(poll,700);}
function dispatchSimulation(){
  clearTimeout(timer);if(sim.paused)return;
  const next=sim.queue.shift();
  if(!next){sim.active=null;sim.device.output='off';sim.paused=true;event('Playback complete. All outputs off.');render();return;}
  next.state='active';next.acknowledged_at=Date.now();sim.active=next;sim.device.output=next.status;event(`${next.cloth_id}: code ${CLASSIFICATIONS[next.status].code} → ${CLASSIFICATIONS[next.status].color}.`);render();
  timer=setTimeout(()=>{next.state='completed';next.finished_at=Date.now();sim.active=null;dispatchSimulation();},sim.display_ms);
}
async function control(action){
  if(busy)return;busy=true;
  try{if(live){snapshot=await api('/api/control',{method:'POST',body:JSON.stringify({action,display_ms:Number($('duration').value)})});render();}
  else{if(action==='resume'){sim.paused=false;dispatchSimulation();}else if(action==='pause'){clearTimeout(timer);if(sim.active){sim.active.state='interrupted';sim.active.reason='Simulation paused';sim.active=null;}sim.paused=true;sim.device.output='off';event('Playback paused. All outputs off.');}
  else if(action==='clear'){for(const item of sim.queue)item.state='cancelled';sim.queue=[];event('Pending queue cleared.');}
  else if(action==='settings'){sim.display_ms=Number($('duration').value);event(`Signal duration set to ${sim.display_ms/1000} seconds.`);}render();}
  }catch(e){notify(e.message,true);}finally{busy=false;}
}
function changeView(next){view=next;for(const name of ['overview','activity','setup'])$(name+'View').classList.toggle('hidden',name!==next);document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('selected',b.dataset.view===next));$('pageHeading').replaceChildren(document.createTextNode({overview:'Scanner control',activity:'Inspection history',setup:'Device & setup'}[next]));const dot=document.createElement('span');dot.className='title-dot';dot.textContent='.';$('pageHeading').append(dot);$('pageSubtitle').textContent={overview:live?'Your vision results. Your table. One clear signal.':'Test a vision result. See the signal come to life.',activity:'Every received result, with its classification and progress.',setup:'Connect your ESP32 and configure the tower outputs.'}[next];if(live&&next==='setup')firmwareUI?.load();}
function validation(){try{const items=parseJSON($('jsonEditor').value);$('validation').textContent=`Valid JSON · ${items.length} result${items.length===1?'':'s'} ready.`;$('validation').className='';return items;}catch(e){$('validation').textContent=e.message;$('validation').className='error-text';return null;}}
function openJSON(text,name='Pasted JSON'){importName=name;$('uploadTitle').textContent=name;$('jsonEditor').value=text;validation();if(!$('uploadDialog').open)$('uploadDialog').showModal();}
async function loadFile(file){if(!file)return;if(file.size>262144){notify('Choose a JSON file smaller than 256 KB.',true);return;}try{openJSON(await file.text(),file.name);}catch{notify('The file could not be read.',true);}}
async function submit(){if(live)return;const items=validation();if(!items||busy)return;busy=true;$('submitJSON').disabled=true;
  try{if(sim.queue.length+items.length>1000)throw new Error('Queue limit reached. Clear or process pending results.');for(const item of items){const entry={id:sim.nextId++,cloth_id:item.cloth_id,status:item.status,payload:item,source:importName,created_at:Date.now(),state:'pending'};sim.queue.push(entry);sim.history.unshift(entry);sim.total++;sim.counts[item.status]++;}event(`Loaded ${items.length} result(s) from ${importName}.`);if(sim.paused){sim.paused=false;dispatchSimulation();}else render();notify(`${items.length} result(s) loaded. Simulation running.`);
  $('uploadDialog').close();changeView('overview');
  }catch(e){notify(e.message,true);}finally{busy=false;$('submitJSON').disabled=false;}
}
function download(filename,text){const url=URL.createObjectURL(new Blob([text],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const sample={schema_version:1,cloths:[{cloth_id:'CL-101',status:2,confidence:.99},{cloth_id:'CL-102',status:1,confidence:.96,defects:[{type:'hole'}]},{cloth_id:'CL-103',status:3,confidence:.92,defects:[{type:'loose_thread'}]},{cloth_id:'CL-104',status:2,confidence:.98}]};
$('sampleButton').onclick=()=>openJSON(JSON.stringify(sample,null,2),'Sample · four cloth results');
$('sampleInline').onclick=$('sampleButton').onclick;
$('formatButton').onclick=()=>openJSON(JSON.stringify({schema_version:1,cloth_id:'CL-001',status:1,confidence:.97},null,2),'JSON format example');
for(const id of ['uploadTop','dropzone'])$(id).onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>{loadFile(e.target.files[0]);e.target.value='';};
$('dropzone').ondragover=e=>{e.preventDefault();$('dropzone').classList.add('dragover');};
$('dropzone').ondragleave=()=>$('dropzone').classList.remove('dragover');
$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('dragover');loadFile(e.dataTransfer.files[0]);};
$('closeUpload').onclick=()=>$('uploadDialog').close();$('validateButton').onclick=validation;$('submitJSON').onclick=submit;
$('runButton').onclick=()=>control('resume');$('pauseButton').onclick=()=>control('pause');$('clearButton').onclick=()=>control('clear');$('duration').onchange=()=>control('settings');
$('allHistory').onclick=()=>changeView('activity');document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>changeView(b.dataset.view));$('historyFilter').onchange=render;
$('configureESP').onclick=()=>{changeView('setup');$('espConfigPanel').scrollIntoView({behavior:'smooth',block:'start'});$('configForm').elements.ssid.focus({preventScroll:true});};
function details(e){const row=e.target.closest('tr[data-id]');if(!row || (e.type==='keydown'&&e.key!=='Enter'&&e.key!==' '))return;if(e.type==='keydown')e.preventDefault();const item=snapshot.history.find(x=>String(x.id)===row.dataset.id);$('detailsTitle').textContent=item.cloth_id;$('detailsJSON').textContent=JSON.stringify(item,null,2);$('detailsDialog').showModal();}
for(const id of ['recentRows','historyRows']){$(id).onclick=details;$(id).onkeydown=details;}$('closeDetails').onclick=()=>$('detailsDialog').close();
$('exportButton').onclick=async()=>{try{download('cloth-inspections.json',JSON.stringify(live?await api('/api/export'):sim.history,null,2));notify('Inspection history exported.');}catch(e){notify(e.message,true);}};
$('loginDialog').addEventListener('cancel',e=>e.preventDefault());
$('loginForm').onsubmit=async e=>{e.preventDefault();token=$('operatorKey').value.trim();try{snapshot=await api('/api/overview');sessionStorage.setItem('selvedge-operator',token);$('operatorKey').value='';$('loginError').textContent='';$('loginDialog').close();render();}catch(err){token='';$('loginError').textContent=err.message;}};
$('logout').onclick=()=>{token='';sessionStorage.removeItem('selvedge-operator');$('loginDialog').showModal();notify('Signed out. The controller keeps its current line state.');};
$('configForm').onsubmit=e=>{e.preventDefault();try{const config=normalizeESPConfig(Object.fromEntries(new FormData(e.target)));download('table_config.h',espHeader(config));notify('table_config.h downloaded. Copy it to esp-code/include/.');}catch(error){notify(error.message,true);}};
function clock(){$('clock').textContent=new Date().toLocaleDateString([],{day:'2-digit',month:'short',year:'numeric'});}clock();setInterval(clock,60000);
if(live){$('configureESP').classList.remove('hidden');firmwareUI=initFirmwareUI({api,notify,download});$('setupView').append($('aiSetup'));$('manualActions').classList.add('hidden');$('manualInput').classList.add('hidden');$('visionFeed').classList.remove('hidden');$('aiSetup').classList.remove('hidden');$('aiEndpoint').textContent=location.origin+'/api/inspections';$('modeBadge').textContent='LIVE CONTROLLER';$('modeBadge').classList.add('live');$('modeLabel').textContent='Continuous AI result stream';$('modeDescription').textContent='AI server → ESP32 → tower light';$('processorLabel').firstChild.textContent='ESP32 controller';$('runTitle').textContent='Table line control';$('totalNote').textContent='All results received · lifetime';$('runHint').textContent='Start once. Every new AI result then processes automatically; the browser can stay closed.';$('outputCaption').textContent='ESP REPORTED OUTPUT';$('footerLabel').textContent='Version 1.0 · automatic AI feed';$('logout').classList.remove('hidden');$('configForm').elements.server.value=location.origin;changeView('overview');if(!token)$('loginDialog').showModal();poll();}
else{event('Simulation ready. Upload JSON or try the sample batch.');render();}
