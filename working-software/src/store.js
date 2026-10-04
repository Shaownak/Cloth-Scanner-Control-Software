import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { parseInspections } from '../../shared/protocol.js';

export class Store {
  constructor(filename, { deviceId = 'table-01', now = () => Date.now() } = {}) {
    this.now = now; this.deviceId = deviceId; this.device = null; this.vision = { last_seen: null, heartbeat_at: null, source: 'AI server' }; this.offId = randomUUID();
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, cloth_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', dispatched_at INTEGER, acknowledged_at INTEGER, finished_at INTEGER, display_ms INTEGER, reason TEXT);
      CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, ids TEXT NOT NULL, fingerprint TEXT);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, message TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS queue_state ON inspections(state,id);`);
    if (!this.db.prepare('PRAGMA table_info(receipts)').all().some(x=>x.name==='fingerprint')) this.db.exec('ALTER TABLE receipts ADD COLUMN fingerprint TEXT');
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES ('display_ms','3000')").run();
    this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('paused','true')").run();
    this.db.prepare("UPDATE inspections SET state='interrupted',reason='Controller restarted',finished_at=? WHERE state='active'").run(this.now());
    this.event('Controller started. Outputs paused until an operator starts the line.');
  }
  setting(key) { return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value; }
  get paused() { return this.setting('paused') === 'true'; }
  event(message) {
    this.db.prepare('INSERT INTO events(at,message) VALUES (?,?)').run(this.now(), message);
    this.db.exec('DELETE FROM events WHERE id < (SELECT MAX(id)-500 FROM events)');
  }
  ingest(input, source, receipt) {
    const items = parseInspections(input);
    const fingerprint=createHash('sha256').update(JSON.stringify(items)).digest('hex');
    if (receipt && (typeof receipt !== 'string' || receipt.length > 120 || !receipt.trim())) throw new Error('Idempotency-Key must be 1–120 characters.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = receipt && this.db.prepare('SELECT ids,fingerprint FROM receipts WHERE key=?').get(receipt);
      if (previous) {
        if (previous.fingerprint && previous.fingerprint!==fingerprint) throw Object.assign(new Error('This idempotency key was already used for different results.'),{status:409});
        this.db.exec('COMMIT'); this.vision.last_seen=this.now(); return { ids: JSON.parse(previous.ids), duplicate: true };
      }
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM inspections WHERE state IN ('pending','active')").get().n;
      if (count + items.length > 1000) throw Object.assign(new Error('Queue capacity is 1,000 results. Process or clear the queue first.'),{status:429});
      const insert = this.db.prepare('INSERT INTO inspections(cloth_id,status,payload,source,created_at) VALUES (?,?,?,?,?)');
      const ids = items.map(item => Number(insert.run(item.cloth_id,item.status,JSON.stringify(item),source,this.now()).lastInsertRowid));
      if (receipt) this.db.prepare('INSERT INTO receipts(key,ids,fingerprint) VALUES (?,?,?)').run(receipt,JSON.stringify(ids),fingerprint);
      this.event(`Received ${ids.length} result${ids.length === 1 ? '' : 's'} from ${source}.`);
      this.db.exec('COMMIT'); this.vision.last_seen=this.now(); return { ids, duplicate: false };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  active() { return this.db.prepare("SELECT * FROM inspections WHERE state='active' ORDER BY id LIMIT 1").get(); }
  visionHeartbeat(input) {
    if (!input || typeof input!=='object' || Array.isArray(input) || (input.source!==undefined && (typeof input.source!=='string' || !input.source.trim() || input.source.length>80))) throw new Error('Heartbeat source must be a nonempty string of up to 80 characters.');
    this.vision={last_seen:this.now(),heartbeat_at:this.now(),source:input.source?.trim() || 'AI server'};
    return {accepted:true};
  }
  stop(reason) {
    this.db.prepare("UPDATE inspections SET state='interrupted',reason=?,finished_at=? WHERE state='active'").run(reason,this.now());
    this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('paused','true')").run();
    this.offId = randomUUID(); this.event(reason);
  }
  control(action, displayMs) {
    if (action === 'pause') this.stop('Operator paused the line. Active result interrupted.');
    else if (action === 'resume') {
      if (!this.device || this.now() - this.device.last_seen > 5000) throw Object.assign(new Error('ESP32 is offline. Connect the device before starting the line.'),{status:409});
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('paused','false')").run(); this.offId = randomUUID(); this.event('Operator started the line.');
    } else if (action === 'clear') {
      if (!this.paused) throw Object.assign(new Error('Pause the line before clearing pending results.'),{status:409});
      this.db.prepare("UPDATE inspections SET state='cancelled',reason='Queue cleared by operator',finished_at=? WHERE state='pending'").run(this.now()); this.event('Pending queue cleared.');
    } else if (action === 'settings') {
      if (!Number.isInteger(displayMs) || displayMs < 1000 || displayMs > 30000) throw new Error('Display duration must be 1,000–30,000 milliseconds.');
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('display_ms',?)").run(String(displayMs)); this.event(`Display duration set to ${displayMs / 1000} seconds.`);
    } else throw new Error('Unknown control action.');
    return this.overview();
  }
  tick() {
    if (!this.paused && this.device && this.now() - this.device.last_seen > 5000) return this.stop('ESP32 connection lost. Line paused.');
    const active = this.active(); if (!active) return;
    const now = this.now();
    if (!active.acknowledged_at && now - active.dispatched_at >= 10000) return this.stop('ESP32 did not acknowledge the command. Line paused.');
    if (active.acknowledged_at && (!this.device || now - this.device.last_seen > 5000)) return this.stop('ESP32 connection lost during inspection. Line paused.');
    if (active.acknowledged_at && now - active.acknowledged_at >= active.display_ms) {
      this.db.prepare("UPDATE inspections SET state='completed',finished_at=? WHERE id=?").run(now,active.id);
      this.offId = randomUUID(); this.event(`${active.cloth_id} completed: ${active.status}.`);
    }
  }
  command() {
    this.tick(); const now = this.now(); let active = this.active();
    if (!this.paused && !active) {
      const next = this.db.prepare("SELECT * FROM inspections WHERE state='pending' ORDER BY id LIMIT 1").get();
      if (next) {
        this.db.prepare("UPDATE inspections SET state='active',dispatched_at=?,display_ms=? WHERE id=?").run(now,Number(this.setting('display_ms')),next.id);
        active = this.active(); this.event(`${active.cloth_id} sent to ESP32.`);
      }
    }
    if (!active || this.paused) return { command_id: this.offId, status: 'off', status_code: 0, cloth_id: null, lease_ms: 4500, reason: this.paused ? 'paused' : 'idle' };
    return { command_id: String(active.id), cloth_id: active.cloth_id, status: active.status, status_code: JSON.parse(active.payload).status_code, lease_ms: 4500 };
  }
  report(report) {
    if (report.device_id !== this.deviceId) throw Object.assign(new Error('Device ID does not match the configured table.'),{status:403});
    if (!['off','good','defected','repairable'].includes(report.output) || typeof report.command_id !== 'string' || report.command_id.length > 80) throw new Error('Invalid device report.');
    this.tick(); const active = this.active();
    if (report.output !== 'off' && (!active || this.paused || report.command_id !== String(active.id) || report.output !== active.status)) throw Object.assign(new Error('Stale or mismatched output. Turn all lights off and poll again.'),{status:409});
    this.device = { device_id: this.deviceId, output: report.output, command_id: report.command_id, last_seen: this.now(), rssi: Number.isFinite(report.rssi) ? report.rssi : null, uptime_ms: Number.isFinite(report.uptime_ms) ? report.uptime_ms : null, firmware: typeof report.firmware === 'string' ? report.firmware.slice(0,40) : 'unknown' };
    if (active && report.command_id === String(active.id)) {
      if (report.output === active.status && !active.acknowledged_at) {
        this.db.prepare('UPDATE inspections SET acknowledged_at=? WHERE id=?').run(this.now(),active.id);
        this.event(`ESP32 reported ${active.status} output for ${active.cloth_id}.`);
      } else if (report.output === 'off') this.stop('ESP32 turned its outputs off during an inspection. Line paused.');
    }
    return { accepted: true };
  }
  overview() {
    this.tick();
    const rows = this.db.prepare('SELECT * FROM inspections ORDER BY id DESC LIMIT 100').all().map(row => ({...row,payload:JSON.parse(row.payload)}));
    const counts = Object.fromEntries(this.db.prepare('SELECT status,COUNT(*) AS n FROM inspections GROUP BY status').all().map(x=>[x.status,x.n]));
    const states = Object.fromEntries(this.db.prepare('SELECT state,COUNT(*) AS n FROM inspections GROUP BY state').all().map(x=>[x.state,x.n]));
    const active = this.active();
    const online = !!this.device && this.now() - this.device.last_seen <= 5000;
    const oldest=this.db.prepare("SELECT created_at FROM inspections WHERE state='pending' ORDER BY id LIMIT 1").get();
    const vision={...this.vision,heartbeat_online:this.vision.heartbeat_at!==null ? this.now()-this.vision.heartbeat_at<=15000 : null,last_result_at:rows[0]?.created_at || null,last_cloth_id:rows[0]?.cloth_id || null,oldest_pending_ms:oldest ? this.now()-oldest.created_at : 0};
    return { paused:this.paused, display_ms:Number(this.setting('display_ms')), counts, states, total:Object.values(counts).reduce((a,b)=>a+b,0), active:active ? {...active,payload:JSON.parse(active.payload)} : null, device: this.device ? {...this.device,online} : {device_id:this.deviceId,online:false,output:'off'}, vision, history:rows, queue:this.db.prepare("SELECT id,cloth_id,status,state FROM inspections WHERE state='pending' ORDER BY id LIMIT 100").all(), events:this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 30').all(), server_time:this.now() };
  }
  close() { this.db.close(); }
}
