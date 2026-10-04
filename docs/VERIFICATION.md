# Verification and hardware acceptance

## Software verification

`npm test` exercises the real controller with temporary SQLite databases and an actual local HTTP server. It checks:

- Requested numeric classification mapping, aliases, malformed and oversize JSON rejection.
- Atomic batch validation before queueing.
- Paused startup, FIFO delivery, matching acknowledgements, stale report rejection.
- Operator pause, offline fault pause, and missing acknowledgement behavior.
- Database persistence and interruption after restart without replaying the active inspection.
- Idempotent submissions and watched-folder archive/error behavior.
- Separate operator, device, and vision permissions; private files cannot be served through the dashboard.
- ESP32 settings validation, isolated configured builds, credential redaction, explicit connected port selection, and upload failure/retry handling using a fake uploader.
- USB HTTP authorization, automatic device key inclusion, pause requirements, and refusal to start the line during installation.

The ESP32 firmware was compiled successfully for `esp32dev` using the pinned project configuration and placeholder settings. The built-in firmware manager also completed a real isolated build with test Wi-Fi settings: 45,844 bytes RAM and 803,785 bytes program flash. USB device enumeration was exercised on this computer and returned no attached serial devices. Physical flashing remains unverified until an ESP32 is connected. The browser simulator was checked with real file upload and the numeric status mapping. A mock device can check the complete dashboard → controller → device report flow without a board:

```powershell
npm start
# In another terminal:
npm run mock-esp
```

Sign in and start the line, then run `integration-examples/continuous_flow_example.py` with SERVER_URL and VISION_TOKEN configured. The AI example sends cloth results automatically; there is no live upload control. The mock reports `MOCK-1.0.0`, making the test source visible. **Stop it before using the physical board**: a mock and a real ESP32 must not share one device ID at the same time.

An automated HTTP test also supplies three per-cloth predictions, verifies red/green/yellow commands and acknowledgements in order, and confirms the line keeps waiting for future cloths. No browser or file upload participates. Run `python tests/ai_sender_test.py` for four additional sender tests: persistent retries after restart, full queue/auth/server failure retention, invalid-result preservation for review, and submission ID conflicts.

These checks do not validate physical wiring, relay polarity, power-on behavior, or lamp operation. Docker configuration is included but was not run on this computer.

## Hardware acceptance sequence

1. Confirm the actual ESP32 model, tower supply voltage, driver voltage compatibility, and active-low/high selection. Configure Wi-Fi/LAN address/key; build and flash the configured firmware.
2. With tower power disconnected, check all three GPIO/driver channels are inactive at startup, during reset, and before the operator starts the line. External inactive-state pulls must keep them off while ESP32 pins float.
3. Energize the tower supply and have the AI process submit status 1: after Start line, only red must light.
4. Have the AI process submit the next cloth with status 2: only green must light.
5. Have the AI process submit the next cloth with status 3: only yellow must light.
6. Run the continuous AI demo: green → red → yellow → green, in order, then all lights off. Check the inspection IDs and progress in history. Close the browser and verify subsequent AI results still drive the ESP32.
7. Select Pause during a result: all lights should release after the next successful poll. Pending results stay queued; the active result becomes interrupted.
8. Stop the server, disable the access point, or remove the ESP32 network connection while green is lit: outputs must release, with the watchdog providing a maximum ~4.5-second unrenewed lease. A dashboard disconnect means output is unconfirmed until reported again.
9. Restart the controller: it must start paused, preserve history/pending results, and avoid replaying an interrupted result.
10. Submit an unknown status such as 9: it must be rejected without adding a good result or energizing a new output.

Record these results for the actual table before production use. No lamp sensor or relay-contact feedback is present, so a stuck contact/broken lamp will require inspection or added hardware feedback.
