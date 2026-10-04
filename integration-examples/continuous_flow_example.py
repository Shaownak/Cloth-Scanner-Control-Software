"""Automatic AI integration demonstration. This process represents your AI server.

Set SERVER_URL and VISION_TOKEN, then run this example alongside the controller.
Replace the predictions below with your actual AI model callback. No browser upload.
"""
import os
import time
import uuid
from ai_sender import VisionSender

token = os.environ.get('VISION_TOKEN')
if not token:
    raise SystemExit('Set VISION_TOKEN to the vision key shown by npm run keys.')
session = uuid.uuid4().hex[:8]
with VisionSender(os.environ.get('SERVER_URL', 'http://localhost:8090'), token,
                  os.environ.get('AI_OUTBOX_FILE', 'ai-outbox.sqlite')) as sender:
    for index, status in enumerate((2, 1, 3, 2), start=1):
        cloth_id = f'AI-DEMO-{session}-{index:03d}'
        # This line belongs immediately after each successful model prediction.
        key = sender.submit({'cloth_id': cloth_id, 'status': status}, submission_id=cloth_id)
        print(f'AI prediction queued automatically: {cloth_id}, code {status}, event {key}')
        time.sleep(4)  # Demo pacing only. Real timing comes from your actual cloth scans.
    deadline = time.monotonic() + 15
    while sender.pending() and time.monotonic() < deadline:
        time.sleep(0.2)
    print(f'Undelivered results saved locally: {sender.pending()}')
