# Continuous AI → ESP32 → tower operation

No user uploads files to the live software. The AI process generates one JSON object after each cloth prediction and sends it automatically. The simulator still accepts manual files for visual testing.

## Version 1 transport

Because the AI transport is not yet specified, version 1 uses HTTP:

```text
AI model callback
  → durable AI outbox
  → controller HTTP API (can run on the AI server itself)
  → persistent cloth queue
  → ESP32 continuous HTTP fetch and GPIO report
  → red / green / yellow tower

Dashboard: monitors the flow and provides start/pause controls.
```

The controller service is the JSON-serving interface on the AI server. The ESP32's SERVER_URL points to that server's LAN address. Alternatively, deploy the controller on another local machine and have the AI process send to it. No open browser is required for receiving, queueing, or displaying cloth results. The operator key is for monitoring/controls; the vision key is for the AI sender; the device key is for the ESP32.

## Add to your AI process

Copy `integration-examples/ai_sender.py` into your AI project and set SERVER_URL and VISION_TOKEN in that process's environment. Python 3.10+ is supported, with no third-party packages required.

```python
import os
from ai_sender import VisionSender

sender = VisionSender(
    server_url=os.environ['SERVER_URL'],  # e.g. http://192.168.1.10:8090
    vision_token=os.environ['VISION_TOKEN'],
    outbox_path='data/cloth-results-outbox.sqlite',
).start()

def on_cloth_prediction(cloth_id, classification_code, inspection_event_id):
    # Invoke after EVERY completed cloth scan; not once per camera frame.
    # 1 = defected/red; 2 = good/green; 3 = repairable/yellow.
    sender.submit(
        {'cloth_id': cloth_id, 'status': classification_code},
        submission_id=inspection_event_id,
    )

# Call sender.close() during your AI process's normal shutdown.
```

Create a unique event ID per physical inspection. Reuse that ID when retrying the same event; a second scan of the same cloth needs a new ID. `submit()` returns after storing the prediction locally. It does not wait for network delivery and is not proof of physical lamp operation. The worker sends results oldest-first, retains transient failures on disk, and retries with the same event ID. Starting the AI process again opens and resumes that same outbox. Run one sender worker per outbox file.

The sender also reports AI liveness every five seconds, so the dashboard can distinguish a connected producer from an overdue heartbeat between cloths. Heartbeats never drive the lamp.

Controller queue capacity is 1,000 results. HTTP 429 means retry later; the durable sender retains those results. Its local outbox limit is 10,000 pending results. `submit()` raises BufferError when full: the AI/table process must slow or stop acquisition rather than discard cloth results. Authentication and network failures remain queued. Invalid results (400/413/415) or conflicting event IDs (409) are preserved in the outbox database's `rejected` table and logged for review; they do not drive a lamp. Configure monitoring of that log/table in the AI process. Fix and explicitly resubmit a rejected event with a new ID.

## Demo without your AI model

Start the controller and connect an ESP32, or use the labelled mock device for a software-only check. Select Start line once after connection. Then, in a separate terminal:

```powershell
$env:SERVER_URL = 'http://localhost:8090'
$env:VISION_TOKEN = 'the-vision-key-from-npm-run-keys'
python integration-examples/continuous_flow_example.py
```

The example automatically generates four distinct cloth events, with codes 2 → 1 → 3 → 2. It submits them at four-second intervals; the dashboard updates on its own. Replace these demo predictions with the actual model's callback. The example creates real demonstration rows in whichever controller you configure, so use a test controller during integration.

## Timing and operation

Start line arms the running table once. It then waits for each future AI result and processes continuously; there is no user action for each cloth. Restart or an ESP32 connection fault leaves the line paused until an operator re-arms it. Between results the tower turns off. The default display duration is three seconds, adjustable from one to thirty seconds.

The table handling cycle must accommodate this display duration plus polling/network latency. FIFO delivery does not discard earlier results, so faster AI arrivals accumulate in the queue. The feed monitor shows pending count and oldest waiting age. This version does not control cloth movement or release the next cloth; synchronize those operations with inspection completion if the tower must identify the cloth physically on the table.

When you choose the final AI protocol, an existing JSON fetch endpoint or MQTT feed can be integrated with an adapter. This version implements the documented HTTP path and does not claim to be connected to a real AI server until you configure and run its sender.
