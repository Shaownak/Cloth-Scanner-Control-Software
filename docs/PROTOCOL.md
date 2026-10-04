# Vision JSON and API

## Input contract

```json
{
  "schema_version": 1,
  "cloth_id": "CL-001",
  "status": 1,
  "confidence": 0.97,
  "captured_at": "2026-10-04T08:00:00+06:00",
  "defects": [{"type": "hole", "position_mm": {"x": 140, "y": 320}}]
}
```

- `cloth_id`: required nonempty string, up to 80 characters, no control characters.
- `status`: required. `1` = defected/red, `2` = good/green, `3` = repairable/yellow. Text and numeric-string equivalents are accepted. `defective`, `non-defected`, and `non_defected` aliases also work.
- `schema_version`: optional; if supplied it must be numeric `1`.
- `confidence`: optional numeric 0–1. It is displayed/stored, not used to override classification.
- `captured_at`: optional parseable date/time; use ISO 8601 with timezone.
- `defects`: optional array, up to 100 entries. Contents are preserved as metadata; the controller does not infer a category or validate defect coordinates.

Additional fields are retained. Unknown classifications are rejected, never treated as good. A low-confidence `status:2` still means green; thresholding is your vision system's responsibility. The scanner-table illustration is illustrative and does not place defects using uploaded coordinates.

Accepted batch forms are `[result1,result2]` and `{"schema_version":1,"cloths":[result1,result2]}`. At most 100 results and 256 KB per request/file. Validation is atomic: a bad row rejects the whole batch before queueing anything.

## Automatic delivery (primary path)

The AI process calls the continuous sender after each prediction. No user uploads JSON to the live dashboard. The controller service may run on the AI server itself. The ESP32 fetches commands from that service continuously. See [AI integration](AI-INTEGRATION.md) for a durable sender and model callback example.

## Watched folder (optional local integration)

Save JSON files in `working-software/vision-inbox/`. The controller checks once per second, in filename order. Produce a `.tmp` file and atomically rename it to `.json` **only after writing is complete**. An incomplete `.json` file is considered invalid and moved to `failed/` with an `.error.txt` explanation. Successful files move to `processed/`. A full queue leaves valid files in the inbox for later.

Identical file bytes are deduplicated with SHA-256, including after a restart. Each new physical inspection should use a distinct cloth ID or timestamp. To intentionally submit an identical result again, use the API with a new submission key. Limit write access to this folder to your trusted vision process.

## Authenticated AI API

`POST http://CONTROLLER_LAN_IP:8090/api/inspections`

Headers:

```text
Content-Type: application/json
Authorization: Bearer YOUR_VISION_KEY
Idempotency-Key: UNIQUE_SUBMISSION_ID
```

The body is one result or a batch. Success returns `201` and `{"ids":[1],"duplicate":false}`. A retry with the same idempotency key and payload returns the same IDs with `200` and `duplicate:true`. Reusing that key for different normalized results returns `409`. When no key is supplied, each request creates a new submission, even for the same cloth ID. Use a stable key for a retry and a new key for a new physical inspection.

Invalid JSON/schema returns 400, unauthorized tokens 401, unrecognized device IDs 403, oversize requests 413, non-JSON content types 415, and full queue 429. Retry 429 later using the same submission key. Batch errors report which row failed. All error bodies use `{"error":"explanation"}`.

Example sender:

```powershell
$env:VISION_TOKEN = 'your-vision-key'
$env:SERVER_URL = 'http://192.168.1.10:8090'
node scripts/send-result.js sample-json/01-defected.json inspection-20261004-001
```

Use `integration-examples/ai_sender.py` for automatic per-cloth delivery with a persistent retry outbox. `send-result.py` and `scripts/send-result.js` remain developer utilities for single requests. Only the vision key can submit results; the operator key cannot.

`POST /api/vision/heartbeat` with the vision bearer key and `{"source":"Camera AI"}` reports AI process liveness. The continuous sender sends this every five seconds. The feed monitor marks a heartbeat overdue after fifteen seconds; an AI heartbeat does not acknowledge a cloth or energize a lamp. A producer may omit heartbeats, in which case the dashboard reports received traffic without claiming a live connection. ESP32 output timeout behavior is independent of this heartbeat.

## Operator routes

All require the operator bearer key.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/overview` | Queue, history (latest 100), counts, reports, recent activity |
| POST | `/api/control` | `{"action":"resume"}`, `pause`, `clear`, or `settings` |
| POST | `/api/control` | `{"action":"settings","display_ms":3000}` |
| GET | `/api/export` | Full inspection history, including source and progress |

Resume requires a fresh ESP32 report. Clear requires a paused line. Status counts represent all valid received results, including queued/cancelled rows; progress shows which were processed.

## ESP32 routes

Require the separate device bearer key. `DEVICE_ID` must match the configured table.

`GET /api/device/command?device_id=table-01`:

```json
{"command_id":"1","cloth_id":"CL-001","status":"defected","status_code":1,"lease_ms":4500}
```

An idle/paused command uses `status:"off"`, `status_code:0`, a unique control ID, and `cloth_id:null`. The same active command may be returned repeatedly to renew its lease; it represents one inspection, not repeated new inspections.

`POST /api/device/report`:

```json
{"device_id":"table-01","command_id":"1","output":"defected","uptime_ms":30000,"rssi":-55,"firmware":"1.0.0"}
```

Output must match the active command. Stale/mismatched non-off reports return 409; firmware immediately releases the outputs. First matching report starts the inspection display duration. Missing initial acknowledgement for ten seconds or loss of device reports for five seconds pauses the line. An off report against the active command interrupts the inspection. A report confirms commanded GPIO state only, not physical lamp operation.
