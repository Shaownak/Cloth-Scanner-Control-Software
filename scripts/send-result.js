import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseJSON} from '../shared/protocol.js';
const filename=process.argv[2];
if(!filename){console.error('Usage: node scripts/send-result.js file.json [stable-submission-id]');process.exit(1);}
try{
  const items=parseJSON(fs.readFileSync(filename,'utf8'));
  const token=process.env.VISION_TOKEN || JSON.parse(fs.readFileSync(fileURLToPath(new URL('../working-software/data/credentials.json',import.meta.url)),'utf8')).vision_token;
  const base=process.env.SERVER_URL || 'http://localhost:8090';
  const submission=process.argv[3] || randomUUID();
  console.log(`Submission ID: ${submission} (reuse this ID for retries)`);
  const res=await fetch(base.replace(/\/$/,'')+'/api/inspections',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':submission},body:JSON.stringify(items),signal:AbortSignal.timeout(5000)});
  const result=await res.json();if(!res.ok)throw new Error(result.error);console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1;}
