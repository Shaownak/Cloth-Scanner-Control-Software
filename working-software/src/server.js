import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { credentials } from './credentials.js';
import { FirmwareManager,requireLocalUSB } from './firmware.js';
import {espHeader} from '../../shared/esp-config.js';
import { bodyJSON,json,staticFile } from '../../shared/http.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
export function createController({dataDir=process.env.DATA_DIR || path.join(root,'working-software/data'),inbox=process.env.INBOX_DIR || path.join(root,'working-software/vision-inbox'),deviceId=process.env.DEVICE_ID || 'table-01'}={}) {
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(deviceId)) throw new Error('DEVICE_ID must contain 1–40 letters, digits, underscores or hyphens.');
  fs.mkdirSync(dataDir,{recursive:true}); fs.mkdirSync(inbox,{recursive:true});
  for(const name of ['processed','failed']) fs.mkdirSync(path.join(inbox,name),{recursive:true});
  const keys=credentials(dataDir); const store=new Store(path.join(dataDir,'controller.sqlite'),{deviceId});
  const firmware=new FirmwareManager({root,dataDir,deviceId,deviceToken:keys.device_token});
  const routes={'/':path.join(root,'shared/dashboard.html'),'/app.js':path.join(root,'shared/dashboard.js'),'/style.css':path.join(root,'shared/style.css'),'/responsive.css':path.join(root,'shared/responsive.css'),'/protocol.js':path.join(root,'shared/protocol.js'),'/esp-config.js':path.join(root,'shared/esp-config.js'),'/firmware-ui.js':path.join(root,'shared/firmware-ui.js'),'/mode.js':path.join(root,'working-software/public/mode.js')};
  function auth(req,roles) {
    const token=(req.headers.authorization || '').replace(/^Bearer /,'');
    const ok=roles.some(role=>{const expected=keys[`${role}_token`];return Buffer.byteLength(token)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(token),Buffer.from(expected));});
    if(!ok) throw Object.assign(new Error('An authorized API key is required.'),{status:401});
  }
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'); const route=url.pathname;
      if(route==='/api/health' && req.method==='GET') return json(res,200,{ok:true,version:'1.0.0'});
      if(route.startsWith('/api/')) {
        if(route==='/api/device/command' && req.method==='GET') {
          auth(req,['device']); if(url.searchParams.get('device_id')!==deviceId) throw Object.assign(new Error('Unknown device ID.'),{status:403});
          return json(res,200,store.command());
        }
        if(route==='/api/device/report' && req.method==='POST') {auth(req,['device']);return json(res,200,store.report(await bodyJSON(req)));}
        if(route==='/api/vision/heartbeat' && req.method==='POST') {auth(req,['vision']);return json(res,200,store.visionHeartbeat(await bodyJSON(req)));}
        if(route==='/api/inspections' && req.method==='POST') {
          auth(req,['vision']); const result=store.ingest(await bodyJSON(req),'AI server / HTTP',req.headers['idempotency-key']); return json(res,result.duplicate?200:201,result);
        }
        auth(req,['operator']);
        if(route.startsWith('/api/firmware/')){
          requireLocalUSB(req);
          if(route==='/api/firmware/tools'&&req.method==='GET'){const ips=[...new Set(Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>x.address))];return json(res,200,{...firmware.tools(),device_id:deviceId,lan_urls:ips.map(ip=>`http://${ip}:${server.address().port}`)});}
          if(route==='/api/firmware/ports'&&req.method==='GET')return json(res,200,{ports:await firmware.ports()});
          if(route==='/api/firmware/state'&&req.method==='GET')return json(res,200,firmware.publicState());
          if(route==='/api/firmware/config'&&req.method==='POST')return json(res,200,{filename:'table_config.h',content:espHeader(firmware.config(await bodyJSON(req)))});
          if((route==='/api/firmware/build'||route==='/api/firmware/upload')&&req.method==='POST'){
            if(!store.paused)throw Object.assign(new Error('Pause the line before building or uploading firmware.'),{status:409});
            const settings=await bodyJSON(req);
            if(!store.paused)throw Object.assign(new Error('Pause the line before building or uploading firmware.'),{status:409});
            return json(res,202,route==='/api/firmware/build'?firmware.startBuild(settings):await firmware.startUpload(settings));
          }
        }
        if(route==='/api/overview' && req.method==='GET') return json(res,200,store.overview());
        if(route==='/api/control' && req.method==='POST') {const b=await bodyJSON(req);if(b.action==='resume'&&firmware.busy())throw Object.assign(new Error('Wait for the firmware operation to finish before starting the line.'),{status:409});return json(res,200,store.control(b.action,b.display_ms));}
        if(route==='/api/export' && req.method==='GET') {
          res.setHeader('Content-Disposition','attachment; filename="cloth-inspections.json"');
          return json(res,200,store.db.prepare('SELECT * FROM inspections ORDER BY id').all().map(x=>({...x,payload:JSON.parse(x.payload)})));
        }
        return json(res,404,{error:'Unknown API route or method.'});
      }
      if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
      return await staticFile(res,route,routes);
    } catch(e) {if(!res.headersSent) json(res,e.status || 400,{error:e.message});}
  });
  server.requestTimeout=10000; server.headersTimeout=10000; server.keepAliveTimeout=5000;
  const ticker=setInterval(()=>store.tick(),100); ticker.unref();
  function watchInbox() {
    for(const name of fs.readdirSync(inbox).filter(x=>x.endsWith('.json')).sort()) {
      const filename=path.join(inbox,name); let content;
      try {
        const stat=fs.lstatSync(filename);
        if(!stat.isFile() || stat.isSymbolicLink()) continue;
        if(stat.size>262144) throw new Error('File must be 256 KB or smaller.');
        content=fs.readFileSync(filename,'utf8');
        const input=JSON.parse(content.replace(/^\uFEFF/,''));
        store.ingest(input,`inbox: ${name}`,'file:'+createHash('sha256').update(content).digest('hex'));
      } catch(e) {
        if(e.code==='ENOENT') continue;
        // A full queue is temporary: keep the file in the inbox for later.
        if(e.message.startsWith('Queue capacity')) continue;
        const target=path.join(inbox,'failed',`${Date.now()}-${name}`);
        try {fs.renameSync(filename,target);fs.writeFileSync(target+'.error.txt',e.message+'\n');store.event(`Rejected inbox file ${name}: ${e.message}`);} catch(moveError) {console.error('Inbox error:',moveError.message);}
        continue;
      }
      try {fs.renameSync(filename,path.join(inbox,'processed',`${Date.now()}-${name}`));} catch(e) {console.error('Cannot archive inbox file:',e.message);}
    }
  }
  const watcher=setInterval(watchInbox,1000); watcher.unref();
  return {server,store,keys,firmware,close:async()=>{clearInterval(ticker);clearInterval(watcher);await new Promise(resolve=>server.close(resolve));await firmware.waitForIdle();store.close();}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createController(); const port=Number(process.env.PORT || 8090); const host=process.env.HOST || '0.0.0.0';
  app.server.listen(port,host,()=>console.log(`Cloth table controller: http://localhost:${port}\nESP32 server URL: http://YOUR_COMPUTER_LAN_IP:${port}\nDevice ID: ${app.store.deviceId}\nThe line starts paused. Run npm run keys to view the three access keys.\nKeep this service on a trusted local network.`));
  const shutdown=async()=>{app.store.stop('Controller shutting down.');await app.close();process.exit(0);};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
