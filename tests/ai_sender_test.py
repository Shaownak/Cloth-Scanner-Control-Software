import json
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integration-examples'))
from ai_sender import VisionSender


class SenderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.accepted = {}
        self.fail_next = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path == '/api/vision/heartbeat':
                    status, response = 200, {'accepted': True}
                elif owner.fail_next:
                    status, owner.fail_next = owner.fail_next, None
                    response = {'error': 'Temporary queue/server failure'}
                else:
                    key = self.headers['Idempotency-Key']
                    duplicate = key in owner.accepted
                    owner.accepted[key] = body
                    status, response = 200 if duplicate else 201, {'ids': [1], 'duplicate': duplicate}
                data = json.dumps(response).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.path = Path(self.temp.name) / 'outbox.sqlite'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.temp.cleanup()

    def sender(self):
        return VisionSender(self.url, 'test-vision-key', self.path)

    def test_queue_full_is_retained_and_restart_delivers_same_event(self):
        sender = self.sender()
        key = sender.submit({'cloth_id': 'cloth-1', 'status': 2}, 'stable-event')
        self.fail_next = 429
        self.assertFalse(sender.flush_once())
        self.assertEqual(sender.pending(), 1)
        restarted = self.sender()
        self.assertTrue(restarted.flush_once())
        self.assertEqual(restarted.pending(), 0)
        self.assertEqual(list(self.accepted), [key])

    def test_network_server_and_auth_failures_preserve_predictions(self):
        sender = self.sender()
        sender.submit({'cloth_id': 'cloth-2', 'status': 3})
        for status in (503, 401):
            self.fail_next = status
            self.assertFalse(sender.flush_once())
            self.assertEqual(sender.pending(), 1)
        self.assertTrue(sender.flush_once())

    def test_rejected_result_is_preserved_for_review(self):
        sender = self.sender()
        key = sender.submit({'cloth_id': 'cloth-3', 'status': 1})
        self.fail_next = 400
        self.assertFalse(sender.flush_once())
        self.assertEqual(sender.pending(), 0)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT id FROM rejected').fetchone()[0], key)

    def test_local_retry_and_conflicting_key(self):
        sender = self.sender()
        payload = {'cloth_id': 'cloth-4', 'status': 2}
        sender.submit(payload, 'event-4')
        sender.submit(payload, 'event-4')
        self.assertEqual(sender.pending(), 1)
        with self.assertRaises(ValueError):
            sender.submit({'cloth_id': 'other', 'status': 1}, 'event-4')
        self.assertEqual(sender.heartbeat(), {'accepted': True})


if __name__ == '__main__':
    unittest.main()
