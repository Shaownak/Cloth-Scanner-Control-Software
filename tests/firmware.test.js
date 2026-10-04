import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {FirmwareManager,requireLocalUSB} from '../working-software/src/firmware.js';
import {normalizeESPConfig,espHeader} from '../shared/esp-config.js';
import {createController} from '../working-software/src/server.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const token='test-device-key-'.repeat(3);
const settings={ssid:'Factory network',password:'example-secret-123',server:'http://192.168.1.10:8090',device:'table-01',redPin:25,greenPin:26,yellowPin:27,polarity:'true'};
test('ESP settings reject invalid pins, loopback addresses, mismatched IDs and injected values',()=>{
  const valid=normalizeESPConfig(settings,{deviceId:'table-01',deviceToken:token});assert.match(espHeader(valid),/#define RED_PIN 25/);
  for(const change of [{server:'http://localhost:8090'},{redPin:6},{redPin:26},{ssid:'a'.repeat(33)},{device:'other'},{redPin:'25;command'},{password:'short'}])assert.throws(()=>normalizeESPConfig({...settings,...change},{deviceId:'table-01',deviceToken:token}));
  const escaped=espHeader(normalizeESPConfig({...settings,ssid:'Factory "A"'},{deviceToken:token}));assert.match(escaped,/Factory \\"A\\"/);
  assert.throws(()=>requireLocalUSB({socket:{remoteAddress:'192.168.1.5'}}),/localhost/);requireLocalUSB({socket:{remoteAddress:'::ffff:127.0.0.1'}});
});

test('USB HTTP workflow requires operator access, pauses installation and blocks re-arming during a build',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloth-usb-api-'));
  const app=createController({dataDir:path.join(dir,'data'),inbox:path.join(dir,'inbox')});let finishBuild;
  app.firmware.python=process.execPath;
  app.firmware.runner=async(exe,args)=>{
    if(args.includes('list'))return {code:0,output:JSON.stringify([{port:'COM7',description:'Test USB UART'}])};
    if(args.includes('upload'))return {code:0,output:'test upload'};
    const project=args[args.indexOf('--project-dir')+1],binary=path.join(project,'.pio','build','esp32dev','firmware.bin');
    fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'test-binary');
    await new Promise(resolve=>{finishBuild=resolve;});return {code:0,output:'test build'};
  };
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(route,role='operator',body)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(role?{Authorization:`Bearer ${app.keys[role+'_token']}`} : {}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await request('/api/firmware/state',null)).status,401);
    assert.equal((await request('/api/firmware/build','device',settings)).status,401);
    assert.equal((await request('/api/firmware/upload','vision',{})).status,401);
    const exported=await (await request('/api/firmware/config','operator',settings)).json();assert.ok(exported.content.includes(app.keys.device_token));
    const command=app.store.command();app.store.report({device_id:'table-01',command_id:command.command_id,output:'off'});app.store.control('resume');
    assert.equal((await request('/api/firmware/build','operator',settings)).status,409);
    assert.equal((await request('/api/firmware/upload','operator',{})).status,409);
    app.store.control('pause');
    const response=await request('/api/firmware/build','operator',settings);assert.equal(response.status,202);const job=await response.json();
    assert.equal((await request('/api/control','operator',{action:'resume'})).status,409);
    assert.equal((await request('/api/firmware/build','operator',settings)).status,409);
    finishBuild();await app.firmware.waitForIdle();
    const ready=await (await request('/api/firmware/state')).json();assert.equal(ready.status,'ready');assert.ok(!JSON.stringify(ready).includes(app.keys.device_token));
    assert.equal((await request('/api/firmware/upload','operator',{job_id:job.id,port:'COM7',confirm_replace:true})).status,202);
    await app.firmware.waitForIdle();assert.equal(app.firmware.publicState().status,'uploaded');
  }finally{finishBuild?.();await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('firmware build isolates credentials, redacts logs and uploads only an explicitly selected connected port',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloth-firmware-'));const calls=[];let ports=[{port:'COM7',description:'USB UART'}],uploadCode=0;
  const runner=async(exe,args,options)=>{
    calls.push(args);
    if(args.includes('list'))return {code:0,output:JSON.stringify(ports)};
    if(args.includes('upload'))return {code:uploadCode,output:'upload'};
    const project=args[args.indexOf('--project-dir')+1];const binary=path.join(project,'.pio','build','esp32dev','firmware.bin');fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'test-binary');
    options.onData?.('Checking '+settings.password+' '+token.slice(0,10));options.onData?.(token.slice(10)+'\n');return {code:0,output:'success'};
  };
  const manager=new FirmwareManager({root,dataDir:dir,deviceId:'table-01',deviceToken:token,pythonPath:process.execPath,runner});
  try{
    const job=manager.startBuild(settings);assert.equal(job.status,'building');assert.throws(()=>manager.startBuild(settings),/already/);await manager.waitForIdle();
    const state=manager.publicState();assert.equal(state.status,'ready');assert.ok(!JSON.stringify(state).includes(token));assert.ok(!JSON.stringify(state).includes(settings.password));assert.match(state.logs,/REDACTED/);
    const header=fs.readFileSync(path.join(dir,'firmware',job.id,'include','table_config.h'),'utf8');assert.ok(header.includes(token));
    await assert.rejects(manager.startUpload({job_id:job.id,port:'COM7'}),/Confirm/);
    await assert.rejects(manager.startUpload({job_id:job.id,port:'COM7;echo injected',confirm_replace:true}),/available/);
    ports=[];await assert.rejects(manager.startUpload({job_id:job.id,port:'COM7',confirm_replace:true}),/no longer/);assert.equal(manager.publicState().status,'ready');
    ports=[{port:'COM7',description:'USB UART'}];await manager.startUpload({job_id:job.id,port:'COM7',confirm_replace:true});await manager.waitForIdle();assert.equal(manager.publicState().status,'uploaded');
    const upload=calls.find(x=>x.includes('upload'));assert.equal(upload[upload.indexOf('--upload-port')+1],'COM7');
    uploadCode=1;await manager.startUpload({job_id:job.id,port:'COM7',confirm_replace:true});await manager.waitForIdle();assert.equal(manager.publicState().status,'upload_failed');
  }finally{await manager.waitForIdle();fs.rmSync(dir,{recursive:true,force:true});}
});
