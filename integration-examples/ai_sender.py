"""Automatic per-cloth sender with a persistent SQLite outbox (standard library).

Import this module into your AI process. One sender worker per outbox file.
The outbox retains undelivered results across network failures and process restarts.
"""
import json
import logging
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid

LOG = logging.getLogger(__name__)


class VisionSender:
    def __init__(self, server_url, vision_token, outbox_path='ai-outbox.sqlite', source='AI server'):
        self.base = server_url.rstrip('/')
        if not self.base.startswith(('http://', 'https://')) or not vision_token:
            raise ValueError('Provide the controller HTTP URL and vision API key.')
        self.token, self.source = vision_token, source
        self.path = str(Path(outbox_path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.stop_event = threading.Event()
        self.thread = None
        with self._db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS outbox (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at REAL NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS rejected (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, reason TEXT NOT NULL, at REAL NOT NULL
                );
            ''')

    @contextmanager
    def _db(self):
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def submit(self, result, submission_id=None):
        """Persist one prediction immediately; worker delivers it without user upload.

        A caller retry should reuse submission_id. Use a fresh ID for a new cloth event.
        A returned ID means saved locally, not yet accepted by the controller or ESP32.
        """
        if not isinstance(result, dict) or not isinstance(result.get('cloth_id'), str) or not result['cloth_id'].strip():
            raise ValueError('Each prediction needs cloth_id and status.')
        value = result.get('status')
        if isinstance(value, bool) or value not in (1, 2, 3, '1', '2', '3', 'defected', 'good', 'repairable'):
            raise ValueError('Use status 1 = red, 2 = green, 3 = yellow.')
        payload = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        if len(payload.encode('utf-8')) > 262144:
            raise ValueError('A result cannot exceed 256 KB.')
        key = submission_id or str(uuid.uuid4())
        if not isinstance(key, str) or not key.strip() or len(key) > 120:
            raise ValueError('submission_id must contain 1–120 characters.')
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT payload FROM outbox WHERE id=?', (key,)).fetchone()
            if existing:
                if existing[0] != payload:
                    raise ValueError('Submission ID already belongs to another local prediction.')
                return key
            if db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0] >= 10000:
                raise BufferError('AI outbox is full. Stop or slow acquisition until delivery recovers.')
            db.execute('INSERT INTO outbox(id,payload,created_at) VALUES(?,?,?)', (key, payload, time.time()))
        return key

    def _post(self, route, payload, key=None):
        headers = {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'}
        if key:
            headers['Idempotency-Key'] = key
        request = urllib.request.Request(self.base + route, data=payload.encode('utf-8'), headers=headers, method='POST')
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read().decode('utf-8'))

    def heartbeat(self):
        """Report AI process liveness even between cloths (does not drive any lamp)."""
        return self._post('/api/vision/heartbeat', json.dumps({'source': self.source}))

    def flush_once(self):
        """Try the oldest local prediction. Retain transient failures for retry."""
        with self._db() as db:
            row = db.execute('SELECT id,payload,attempts FROM outbox ORDER BY rowid LIMIT 1').fetchone()
        if not row:
            return False
        key, payload, attempts = row
        try:
            response = self._post('/api/inspections', payload, key)
            if not isinstance(response, dict) or not isinstance(response.get('ids'), list) or len(response['ids']) != 1:
                raise ValueError('Controller did not return one accepted inspection ID.')
        except (urllib.error.URLError, OSError, ValueError) as error:
            # A full controller queue (429), authentication error (401), or a
            # network/server error must retain the result rather than lose a cloth.
            status = getattr(error, 'code', None)
            reason = str(error)
            if isinstance(error, urllib.error.HTTPError):
                reason += ': ' + error.read(2000).decode('utf-8', errors='replace')
            with self._db() as db:
                if status in (400, 409, 413, 415):
                    db.execute('INSERT OR REPLACE INTO rejected VALUES(?,?,?,?)', (key, payload, reason, time.time()))
                    db.execute('DELETE FROM outbox WHERE id=?', (key,))
                    LOG.error('AI result %s rejected; saved for review in outbox rejected table: %s', key, reason)
                else:
                    db.execute('UPDATE outbox SET attempts=attempts+1,last_error=? WHERE id=?', (reason, key))
                    if attempts == 0:
                        LOG.warning('AI result %s retained for retry: %s', key, reason)
            return False
        with self._db() as db:
            db.execute('DELETE FROM outbox WHERE id=?', (key,))
        return True

    def pending(self):
        with self._db() as db:
            return db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0]

    def _run(self):
        last_heartbeat = 0
        while not self.stop_event.is_set():
            if time.monotonic() - last_heartbeat >= 5:
                last_heartbeat = time.monotonic()
                try:
                    self.heartbeat()
                except (urllib.error.URLError, OSError, ValueError):
                    pass  # Result delivery retains and reports its own failures.
            try:
                delivered = self.flush_once()
            except sqlite3.Error as error:
                LOG.error('Outbox storage error; delivery will retry: %s', error)
                delivered = False
            self.stop_event.wait(0.02 if delivered else 2)

    def start(self):
        if not self.thread or not self.thread.is_alive():
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._run, name='vision-result-sender', daemon=True)
            self.thread.start()
        return self

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=7)

    def __enter__(self):
        return self.start()

    def __exit__(self, *_):
        self.close()
