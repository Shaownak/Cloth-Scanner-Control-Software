// Isolated demonstration of the real controller API. Never uses production data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createController} from '../working-software/src/server.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataDir=path.join(root,'videos/main-demo-data');
const app=createController({dataDir,inbox:path.join(dataDir,'inbox')});
const base='http://localhost:8092';
await new Promise(resolve=>app.server.listen(8092,'127.0.0.1',resolve));
const mock=spawn(process.execPath,[path.join(root,'scripts/mock-esp.js')],{env:{...process.env,SERVER_URL:base,CREDENTIALS_FILE:path.join(dataDir,'credentials.json')},windowsHide:true,stdio:['ignore','inherit','inherit']});
const request=async(route,body)=>{
  const response=await fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${app.keys.vision_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Demo AI delivery failed: ${response.status}`);
};
let next=0,due=0,sending=false;const statuses=[2,1,3,2];
const heartbeat=setInterval(()=>request('/api/vision/heartbeat',{source:'DEMO AI SERVER / sample predictions'}).catch(error=>console.error(error.message)),1500);
const feed=setInterval(async()=>{
  if(sending||app.store.paused||next>=statuses.length||Date.now()<due)return;
  sending=true;
  try{const cloth_id=`DEMO-CLOTH-${String(next+1).padStart(3,'0')}`;await request('/api/inspections',{schema_version:1,cloth_id,status:statuses[next],confidence:.98});console.log(`DEMO AI SERVER automatically sent ${cloth_id}, code ${statuses[next]}`);next++;due=Date.now()+5800;}
  catch(error){console.error(error.message);}
  finally{sending=false;}
},200);
console.log('MAIN SOFTWARE VIDEO DEMO: localhost:8092 / separate private data / mock ESP32 / sample AI results.');
let closing=false;
async function close(){if(closing)return;closing=true;clearInterval(feed);clearInterval(heartbeat);mock.kill();await app.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
