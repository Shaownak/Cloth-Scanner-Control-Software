import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export function credentials(dataDir) {
  fs.mkdirSync(dataDir,{recursive:true}); const filename=path.join(dataDir,'credentials.json');
  let saved;
  try { saved=JSON.parse(fs.readFileSync(filename,'utf8')); }
  catch(e) {
    if(e.code !== 'ENOENT') throw new Error('Cannot read credentials.json. Restore the file or explicitly replace it.');
    saved={operator_token:randomBytes(24).toString('hex'),device_token:randomBytes(24).toString('hex'),vision_token:randomBytes(24).toString('hex')};
    fs.writeFileSync(filename,JSON.stringify(saved,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const result={operator_token:process.env.OPERATOR_TOKEN || saved.operator_token,device_token:process.env.DEVICE_TOKEN || saved.device_token,vision_token:process.env.VISION_TOKEN || saved.vision_token};
  if(Object.values(result).some(v=>typeof v!=='string'||v.length<24)||new Set(Object.values(result)).size!==3) throw new Error('Use three different API tokens, each at least 24 characters long.');
  return result;
}
