import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../working-software/src/store.js';
import {createController} from '../working-software/src/server.js';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloth-test-'));let time=100000;const store=new Store(path.join(dir,'test.sqlite'),{now:()=>time});return {store,dir,advance:ms=>time+=ms,cleanup:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}
function report(store,command,output=command.status){return store.report({device_id:'table-01',command_id:command.command_id,output,rssi:-50,firmware:'TEST'});}
function connect(store){const command=store.command();report(store,command);return command;}
test('safe startup, atomic ingestion, FIFO delivery, acknowledgement, and pause',()=>{
  const f=fixture();try{const s=f.store;assert.equal(s.command().status,'off');assert.throws(()=>s.control('resume'),/offline/);
    assert.throws(()=>s.ingest([{cloth_id:'a',status:2},{cloth_id:'b',status:9}],'test'));assert.equal(s.overview().total,0);
    s.ingest([{cloth_id:'a',status:1},{cloth_id:'b',status:2},{cloth_id:'c',status:3}],'test');connect(s);s.control('resume');
    const a=s.command();assert.equal(a.status,'defected');assert.equal(a.status_code,1);assert.equal(s.overview().active.acknowledged_at,null);
    assert.throws(()=>report(s,a,'good'),/mismatched/);report(s,a);assert.equal(s.overview().device.output,'defected');
    assert.equal(s.command().command_id,a.command_id);f.advance(3001);const b=s.command();assert.equal(b.status,'good');
    assert.throws(()=>report(s,a),/Stale/);report(s,b);s.control('pause');assert.equal(s.command().status,'off');
    assert.equal(s.overview().history.find(x=>x.cloth_id==='b').state,'interrupted');assert.equal(s.overview().queue[0].cloth_id,'c');
  }finally{f.cleanup();}
});
test('lost reports and missed acknowledgements pause without advancing the queue',()=>{
  const f=fixture();try{const s=f.store;s.ingest([{cloth_id:'a',status:2},{cloth_id:'b',status:1}],'test');connect(s);s.control('resume');const a=s.command();report(s,a);f.advance(5001);s.tick();assert.equal(s.paused,true);assert.equal(s.overview().queue.length,1);assert.equal(s.command().status,'off');
    connect(s);s.control('resume');const b=s.command();for(let i=0;i<4;i++){f.advance(2500);s.report({device_id:'table-01',command_id:'old-off',output:'off'});}assert.equal(s.paused,true);assert.equal(s.command().status,'off');assert.equal(s.overview().history.find(x=>String(x.id)===b.command_id).state,'interrupted');
  }finally{f.cleanup();}
});
test('persistence survives restart and a running result is not replayed',()=>{
  const f=fixture();let reopened;try{const s=f.store;const input={cloth_id:'persist',status:3};assert.equal(s.ingest(input,'test','key-1').duplicate,false);assert.equal(s.ingest(input,'test','key-1').duplicate,true);assert.throws(()=>s.ingest({cloth_id:'different',status:1},'test','key-1'),/different results/);assert.equal(s.overview().total,1);connect(s);s.control('resume');report(s,s.command());s.close();
    reopened=new Store(path.join(f.dir,'test.sqlite'));assert.equal(reopened.paused,true);assert.equal(reopened.command().status,'off');assert.equal(reopened.overview().history[0].state,'interrupted');assert.equal(reopened.ingest(input,'test','key-1').duplicate,true);
  }finally{reopened?.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('HTTP authentication scopes, automatic AI delivery, heartbeat, and inbox archive',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloth-api-'));const app=createController({dataDir:path.join(dir,'data'),inbox:path.join(dir,'inbox')});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(route,role,method='GET',body)=>fetch(base+route,{method,headers:{...(role?{Authorization:`Bearer ${app.keys[role+'_token']}`} : {}),'Content-Type':'application/json'},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await request('/api/overview')).status,401);
    assert.equal((await request('/api/overview','device')).status,401);
    assert.equal((await request('/api/device/command?device_id=table-01','operator')).status,401);
    assert.equal((await request('/api/device/command?device_id=wrong','device')).status,403);
    assert.equal((await request('/api/control','vision','POST',{action:'resume'})).status,401);
    assert.equal((await request('/api/inspections','operator','POST',{cloth_id:'manual',status:1})).status,401);
    assert.equal((await request('/api/vision/heartbeat','device','POST',{})).status,401);
    assert.equal((await request('/api/vision/heartbeat','vision','POST',{source:'Camera AI'})).status,200);
    assert.equal(app.store.overview().vision.heartbeat_online,true);
    assert.equal((await request('/api/inspections','vision','POST',{cloth_id:'api-1',status:2})).status,201);
    assert.equal((await request('/api/inspections','vision','POST','x'.repeat(262145))).status,413);
    assert.equal((await request('/api/inspections','vision','POST','{broken')).status,400);
    assert.equal((await fetch(base+'/api/inspections',{method:'POST',headers:{Authorization:`Bearer ${app.keys.vision_token}`},body:'{}'})).status,415);
    assert.equal((await request('/data/credentials.json')).status,404);
    // Exercise the full HTTP vision → queue → ESP command → reported output flow.
    const idle=await (await request('/api/device/command?device_id=table-01','device')).json();
    assert.equal((await request('/api/device/report','device','POST',{device_id:'table-01',command_id:idle.command_id,output:'off',firmware:'MOCK-TEST'})).status,200);
    assert.equal((await request('/api/control','operator','POST',{action:'settings',display_ms:1000})).status,200);
    assert.equal((await request('/api/control','operator','POST',{action:'resume'})).status,200);
    const command=await (await request('/api/device/command?device_id=table-01','device')).json();assert.equal(command.status_code,2);
    assert.equal((await request('/api/device/report','device','POST',{device_id:'table-01',command_id:command.command_id,output:'good',firmware:'MOCK-TEST'})).status,200);
    await new Promise(resolve=>setTimeout(resolve,1100));
    const finished=await (await request('/api/overview','operator')).json();assert.equal(finished.history[0].state,'completed');
    const allOff=await (await request('/api/device/command?device_id=table-01','device')).json();assert.equal(allOff.status_code,0);
    assert.equal((await request('/api/control','operator','POST',{action:'pause'})).status,200);
    fs.writeFileSync(path.join(dir,'inbox','vision.json'),JSON.stringify({cloth_id:'folder-1',status:1}));
    fs.writeFileSync(path.join(dir,'inbox','bad.json'),'{bad');
    await new Promise(resolve=>setTimeout(resolve,1200));
    const overview=await (await request('/api/overview','operator')).json();assert.equal(overview.total,2);
    assert.equal(fs.readdirSync(path.join(dir,'inbox','processed')).length,1);
    assert.equal(fs.readdirSync(path.join(dir,'inbox','failed')).length,2);
    // Repeat the exact bytes: the folder receipt prevents a second ingestion.
    fs.writeFileSync(path.join(dir,'inbox','retry.json'),JSON.stringify({cloth_id:'folder-1',status:1}));
    await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(app.store.overview().total,2);
  }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('a continuous per-cloth AI stream runs without a browser session or manual uploads',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloth-stream-'));const app=createController({dataDir:path.join(dir,'data'),inbox:path.join(dir,'inbox')});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
  const req=async(route,role,body,receipt)=>{const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${app.keys[role+'_token']}`,'Content-Type':'application/json',...(receipt?{'Idempotency-Key':receipt}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(res.ok,await res.clone().text());return res.json();};
  try{
    const report=command=>req('/api/device/report','device',{device_id:'table-01',command_id:command.command_id,output:command.status,firmware:'STREAM-TEST'});
    await report(await req('/api/device/command?device_id=table-01','device'));
    await req('/api/control','operator',{action:'settings',display_ms:1000});
    await req('/api/control','operator',{action:'resume'});
    for(const [index,code] of [1,2,3].entries()){
      const payload={cloth_id:`automatic-${index}`,status:code};
      const received=await req('/api/inspections','vision',payload,`event-${index}`);assert.equal(received.duplicate,false);
      const retry=await req('/api/inspections','vision',payload,`event-${index}`);assert.equal(retry.duplicate,true);
      const command=await req('/api/device/command?device_id=table-01','device');assert.equal(command.status_code,code);assert.equal(command.cloth_id,payload.cloth_id);
      await report(command);await new Promise(resolve=>setTimeout(resolve,1050));
      await report(await req('/api/device/command?device_id=table-01','device'));
    }
    const state=app.store.overview();assert.equal(state.total,3);assert.equal(state.states.completed,3);assert.equal(state.paused,false);assert.equal(state.device.output,'off');assert.equal(state.vision.last_cloth_id,'automatic-2');
  }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
