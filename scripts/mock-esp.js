// Protocol test client. It does not switch real GPIO or certify physical wiring.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base=process.env.SERVER_URL || 'http://localhost:8090';
const keys=JSON.parse(readFileSync(process.env.CREDENTIALS_FILE || fileURLToPath(new URL('../working-software/data/credentials.json',import.meta.url)),'utf8'));
const token=process.env.DEVICE_TOKEN || keys.device_token;
const device=process.env.DEVICE_ID || 'table-01';
let previous='';
console.log(`MOCK ESP32 · ${base} · no real hardware. Stop this before connecting the physical board.`);
let running=true;process.on('SIGINT',()=>{running=false;});
while(running){
  try{
    const headers={Authorization:`Bearer ${token}`};
    const response=await fetch(`${base}/api/device/command?device_id=${encodeURIComponent(device)}`,{headers,signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw new Error(`Command rejected: ${response.status}`);
    const command=await response.json();
    if(command.command_id!==previous){console.log(`${new Date().toISOString()} · ${command.cloth_id || 'idle'} · ${command.status}`);previous=command.command_id;}
    const report=await fetch(`${base}/api/device/report`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({device_id:device,command_id:command.command_id,output:command.status,rssi:-42,uptime_ms:Math.floor(process.uptime()*1000),firmware:'MOCK-1.0.0'}),signal:AbortSignal.timeout(2000)});
    if(!report.ok)console.log(`Report rejected: ${report.status}. Mock output off.`);
  }catch(e){console.error(e.message);}
  await new Promise(resolve=>setTimeout(resolve,400));
}
