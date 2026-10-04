"""Send a vision result with Python's standard library.

Set SERVER_URL and VISION_TOKEN. Supply a stable submission ID to retry safely:
python send-result.py result.json camera-01-frame-123
"""
import json
import os
from pathlib import Path
import sys
import urllib.request
import urllib.error
import uuid

if len(sys.argv) < 2:
    raise SystemExit('Usage: python send-result.py file.json [stable-submission-id]')
token = os.environ.get('VISION_TOKEN')
if not token:
    raise SystemExit('Set VISION_TOKEN to the controller vision key.')
payload = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
submission = sys.argv[2] if len(sys.argv) > 2 else str(uuid.uuid4())
print(f'Submission ID: {submission} (reuse this ID for retries)')
request = urllib.request.Request(
    os.environ.get('SERVER_URL', 'http://localhost:8090').rstrip('/') + '/api/inspections',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Idempotency-Key': submission},
    method='POST',
)
try:
    with urllib.request.urlopen(request, timeout=5) as response:
        print(response.read().decode('utf-8'))
except urllib.error.HTTPError as error:
    raise SystemExit(error.read().decode('utf-8')) from error
