export function initFirmwareUI({api,notify,download}){
  const $=id=>document.getElementById(id),form=$('configForm');
  let state={status:'idle'},toolsReady=false,dirty=false,loaded=false,refreshing=false;
  $('usbInstaller').classList.remove('hidden');$('deviceTokenRow').classList.add('hidden');form.elements.token.required=false;form.elements.token.disabled=true;
  $('buildFirmware').textContent='1 · Build firmware';$('downloadESPConfig').classList.remove('hidden');
  function busy(){return ['building','preparing','uploading'].includes(state.status);}
  function draw(){
    $('firmwareStatus').textContent={idle:'Ready for setup',building:'Building firmware',preparing:'Checking USB port',ready:'Ready to upload',uploading:'Uploading to ESP32',uploaded:'Upload complete',failed:'Build failed',upload_failed:'Upload failed'}[state.status] || state.status;
    $('firmwareMessage').textContent=state.message || 'Enter settings, build firmware, then upload to your selected ESP32.';
    $('firmwareStatus').classList.toggle('active',['ready','uploaded'].includes(state.status));
    $('buildFirmware').disabled=busy()||!toolsReady;$('downloadESPConfig').disabled=busy();
    for(const input of form.querySelectorAll('input,select'))if(input.name!=='token')input.disabled=busy();
    $('refreshUSB').disabled=busy();$('usbPort').disabled=busy();$('confirmFlash').disabled=busy();
    $('uploadFirmware').disabled=!toolsReady||busy()||dirty||!['ready','uploaded','upload_failed'].includes(state.status)||!$('usbPort').value||!$('confirmFlash').checked;
    $('rebuildHint').classList.toggle('hidden',!dirty);
    $('builtTarget').textContent=state.config?`Built for ${state.config.ssid} · ${state.config.server} · ${state.config.device}`:'';
    const log=$('firmwareLog'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    log.textContent=state.logs || 'Build and upload progress will appear here.';
    if(atBottom)log.scrollTop=log.scrollHeight;
  }
  async function refreshPorts(){
    const selected=$('usbPort').value;try{
      const result=await api('/api/firmware/ports');$('usbPort').replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=result.ports.length?'Select your ESP32 USB port':'No serial devices detected';$('usbPort').append(placeholder);
      for(const port of result.ports){const option=document.createElement('option');option.value=port.port;option.textContent=`${port.port} · ${port.description}`;$('usbPort').append(option);}
      if(result.ports.some(p=>p.port===selected))$('usbPort').value=selected;
      $('usbHint').textContent=result.ports.length?'Choose the port belonging to your ESP32. Ports are on the controller computer.':'Connect the ESP32 to this computer using a USB data cable, then refresh ports.';
    }catch(error){$('usbHint').textContent=error.message;}draw();
  }
  async function load(){
    if(refreshing)return;refreshing=true;
    try{
      const tools=await api('/api/firmware/tools');toolsReady=tools.available;$('firmwareTools').textContent=tools.message;
      if(!loaded){form.elements.device.value=tools.device_id || form.elements.device.value;if(tools.lan_urls?.length===1&&form.elements.server.value===location.origin)form.elements.server.value=tools.lan_urls[0];}
      $('lanAddressHint').textContent=tools.lan_urls?.length?'Controller LAN addresses: '+tools.lan_urls.join(' · '):'Use the controller computer LAN address, reachable from your ESP32.';
      state=await api('/api/firmware/state');loaded=true;draw();if(toolsReady)await refreshPorts();
    }catch(error){toolsReady=false;$('firmwareTools').textContent=error.message;draw();}finally{refreshing=false;}
  }
  function settings(){if(!form.reportValidity())return null;return Object.fromEntries(new FormData(form));}
  form.onsubmit=async event=>{event.preventDefault();const values=settings();if(!values)return;try{state=await api('/api/firmware/build',{method:'POST',body:JSON.stringify(values)});dirty=false;draw();notify('Building your configured firmware.');}catch(error){notify(error.message,true);}};
  $('downloadESPConfig').onclick=async()=>{const values=settings();if(!values)return;try{const result=await api('/api/firmware/config',{method:'POST',body:JSON.stringify(values)});download(result.filename,result.content);notify('ESP32 configuration downloaded.');}catch(error){notify(error.message,true);}};
  form.addEventListener('input',()=>{dirty=true;draw();});form.addEventListener('change',()=>{dirty=true;draw();});
  $('refreshUSB').onclick=refreshPorts;$('usbPort').onchange=()=>{$('confirmFlash').checked=false;draw();};$('confirmFlash').onchange=draw;
  $('uploadFirmware').onclick=async()=>{try{state=await api('/api/firmware/upload',{method:'POST',body:JSON.stringify({job_id:state.id,port:$('usbPort').value,confirm_replace:$('confirmFlash').checked})});draw();notify('Uploading firmware to your selected ESP32.');}catch(error){notify(error.message,true);}};
  setInterval(async()=>{if(!loaded||document.getElementById('setupView').classList.contains('hidden')||refreshing)return;try{state=await api('/api/firmware/state');draw();}catch{/* A reconnect error is already shown by the dashboard. */}},1000);
  return {load};
}
