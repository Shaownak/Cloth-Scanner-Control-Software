import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {normalizeESPConfig,espHeader} from '../../shared/esp-config.js';

export function runTool(executable,args,{env,onData,timeoutMs=300000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let output='',timedOut=false;
    const add=chunk=>{const value=chunk.toString();output=(output+value).slice(-200000);onData?.(value);};
    child.stdout.on('data',add);child.stderr.on('data',add);
    const timeout=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);timeout.unref();
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.on('close',code=>{clearTimeout(timeout);if(timedOut)reject(new Error('Firmware tool timed out. Check the USB connection or build tools.'));else resolve({code,output});});
  });
}
export function requireLocalUSB(req) {
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) throw Object.assign(new Error('USB firmware setup is available from localhost on the computer running this controller.'),{status:403});
}
export class FirmwareManager {
  constructor({root,dataDir,deviceId,deviceToken,runner=runTool,pythonPath}={}) {
    this.root=root;this.dataDir=dataDir;this.deviceId=deviceId;this.deviceToken=deviceToken;this.runner=runner;
    this.python=pythonPath || process.env.PIO_PYTHON || path.join(root,'.tools','pio-venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
    this.env={...process.env,PLATFORMIO_CORE_DIR:process.env.PLATFORMIO_CORE_DIR || path.join(root,'.tools','pio-core'),PLATFORMIO_SETTING_ENABLE_TELEMETRY:'No'};
    this.job=null;this.completion=null;
  }
  tools() {return {available:fs.existsSync(this.python)&&fs.existsSync(path.join(this.root,'esp-code','platformio.ini')),board:'ESP32 DevKit / WROOM-32',message:fs.existsSync(this.python)?'Local firmware tools detected.':'Firmware tools are missing. Run Setup-ESP32-Tools.cmd on this computer.'};}
  ensureTools(){if(!this.tools().available)throw Object.assign(new Error(this.tools().message),{status:503});}
  async ports(){
    this.ensureTools();const result=await this.runner(this.python,['-m','platformio','device','list','--json-output'],{env:this.env,timeoutMs:10000});
    if(result.code!==0)throw new Error('Could not list USB ports. Check the local PlatformIO installation.');
    let ports;try{ports=JSON.parse(result.output.trim());}catch{throw new Error('The USB device list could not be read.');}
    if(!Array.isArray(ports))throw new Error('The USB device list is invalid.');
    return ports.filter(item=>typeof item.port==='string'&&isSerialPort(item.port)).map(item=>({port:item.port,description:String(item.description || 'Serial device').slice(0,150),hwid:String(item.hwid || '').slice(0,200)}));
  }
  config(input){return normalizeESPConfig(input,{deviceId:this.deviceId,deviceToken:this.deviceToken});}
  busy(){return !!this.job&&['building','preparing','uploading'].includes(this.job.status);}
  publicState(){
    if(!this.job)return {status:'idle',message:'Enter settings, build firmware, then upload to your selected USB port.'};
    let logs=this.job.rawLogs;
    for(const secret of [this.job.config.password,this.deviceToken])if(secret){logs=logs.split(secret).join('[REDACTED]');logs=logs.split(JSON.stringify(secret).slice(1,-1)).join('[REDACTED]');}
    const {ssid,server,device,redPin,greenPin,yellowPin,polarity}=this.job.config;
    return {id:this.job.id,status:this.job.status,message:this.job.message,port:this.job.port || null,config:{ssid,server,device,redPin,greenPin,yellowPin,polarity},started_at:this.job.startedAt,finished_at:this.job.finishedAt || null,logs:logs.replace(/\u001b\[[0-9;]*[a-zA-Z]/g,'').slice(-30000)};
  }
  startBuild(input){
    this.ensureTools();if(this.busy())throw Object.assign(new Error('A firmware operation is already running.'),{status:409});
    const config=this.config(input),id=randomUUID();const directory=path.join(this.dataDir,'firmware',id);
    fs.mkdirSync(path.join(directory,'src'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(directory,'include'),{recursive:true,mode:0o700});
    fs.copyFileSync(path.join(this.root,'esp-code','src','main.cpp'),path.join(directory,'src','main.cpp'));
    fs.copyFileSync(path.join(this.root,'esp-code','platformio.ini'),path.join(directory,'platformio.ini'));
    fs.copyFileSync(path.join(this.root,'esp-code','include','table_config.example.h'),path.join(directory,'include','table_config.example.h'));
    const cachedLibraries=path.join(this.root,'esp-code','.pio','libdeps','esp32dev');
    if(fs.existsSync(cachedLibraries))fs.cpSync(cachedLibraries,path.join(directory,'.pio','libdeps','esp32dev'),{recursive:true});
    fs.writeFileSync(path.join(directory,'include','table_config.h'),espHeader(config),{mode:0o600});
    this.job={id,config,directory,status:'building',message:'Building your configured ESP32 firmware…',startedAt:Date.now(),rawLogs:'Building firmware with your Wi-Fi and output settings.\n'};
    this.completion=this.execute(['run','--project-dir',directory,'--environment','esp32dev'],'ready','Build successful. Select the ESP32 USB port and upload firmware.');
    return this.publicState();
  }
  async startUpload({job_id,port,confirm_replace}={}){
    if(this.busy())throw Object.assign(new Error('A firmware operation is already running.'),{status:409});
    if(!this.job||this.job.id!==job_id||!['ready','uploaded','upload_failed'].includes(this.job.status))throw Object.assign(new Error('Build the firmware successfully before uploading.'),{status:409});
    if(confirm_replace!==true)throw new Error('Confirm that uploading replaces the existing firmware on the selected ESP32.');
    if(typeof port!=='string'||!isSerialPort(port))throw new Error('Select an available USB serial port.');
    const previous=this.job.status;this.job.status='preparing';
    let ports;try{ports=await this.ports();if(!ports.some(item=>item.port===port))throw Object.assign(new Error('The selected USB port is no longer connected. Refresh ports and reconnect the ESP32.'),{status:409});}
    catch(error){this.job.status=previous;throw error;}
    this.job.port=port;this.job.status='uploading';this.job.finishedAt=null;this.job.message=`Uploading firmware to ${port}…`;this.job.rawLogs+='\nUploading to the explicitly selected USB port.\n';
    // The port is never auto-selected, and process arguments never pass through a shell.
    this.completion=this.execute(['run','--project-dir',this.job.directory,'--environment','esp32dev','--target','upload','--upload-port',port],'uploaded','Upload successful. ESP32 is rebooting; wait for its Wi-Fi report.');
    return this.publicState();
  }
  async execute(args,successStatus,message){
    const job=this.job;const uploading=job.status==='uploading';
    try {
      const result=await this.runner(this.python,['-m','platformio',...args],{env:this.env,onData:text=>{job.rawLogs=(job.rawLogs+text).slice(-200000);}});
      if(result.code!==0)throw new Error(uploading?'Upload failed. Check the port, USB data cable, and BOOT button; close other serial monitors and retry.':'Build failed. Review the build log and configuration.');
      const binary=path.join(job.directory,'.pio','build','esp32dev','firmware.bin');
      if(!uploading&&!fs.existsSync(binary))throw new Error('The build did not produce a firmware binary.');
      job.status=successStatus;job.message=message;
    }catch(error){job.status=uploading?'upload_failed':'failed';job.message=error.message;job.rawLogs+='\n'+error.message+'\n';}
    finally{job.finishedAt=Date.now();}
  }
  async waitForIdle(){await this.completion;}
}
export function isSerialPort(port){return /^COM[1-9][0-9]*$/i.test(port)||/^\/dev\/(tty(?:USB|ACM)[0-9]+|cu\.[A-Za-z0-9._-]+)$/.test(port);}
