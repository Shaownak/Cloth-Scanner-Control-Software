import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { staticFile, json } from '../shared/http.js';
const file = p => fileURLToPath(new URL(p, import.meta.url));
const routes = { '/': file('../shared/dashboard.html'), '/app.js': file('../shared/dashboard.js'), '/style.css': file('../shared/style.css'), '/responsive.css': file('../shared/responsive.css'), '/protocol.js': file('../shared/protocol.js'), '/esp-config.js':file('../shared/esp-config.js'), '/firmware-ui.js':file('../shared/firmware-ui.js'), '/mode.js': file('./mode.js') };
const server = http.createServer((req,res) => {
  if (req.method !== 'GET') return json(res,405,{error:'This simulator only serves local files.'});
  staticFile(res,new URL(req.url,'http://localhost').pathname,routes);
});
server.listen(Number(process.env.SIM_PORT || 8091), '127.0.0.1', () => console.log(`Cloth table simulator: http://localhost:${server.address().port}\nSimulation is isolated: it never sends commands to hardware.`));
