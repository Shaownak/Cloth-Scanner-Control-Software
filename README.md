# Advanced AI Lab - Cloth Scanner · Version 1

Two separate systems for your first cloth scanner table: a browser simulator and an automatic AI-to-ESP32 controller with a monitoring dashboard. No vision model is included; your AI process sends one classification JSON per cloth continuously. Manual JSON upload belongs to the simulator.

| Vision status | Classification | Tower output | Default ESP32 GPIO |
| --- | --- | --- | --- |
| `1` | Defected | Red | 25 |
| `2` | Good / non-defected | Green | 26 |
| `3` | Repairable | Yellow | 27 |

## Start the simulator

Double-click **Start-Simulation.cmd**, then open **http://localhost:8091**. Upload a file from `sample-json/`, review it, and select **Load results**. Each result lights one virtual lamp for the chosen duration. A batch plays in order; all lamps turn off at the end. The simulator never contacts the ESP32 or the deployment controller. Reloading clears the simulation session.

For a command-line start, run `npm run simulate`. Node.js **24 or newer** is required and is already present on this computer. There are no npm dependencies to install.

## Start the deployment controller

1. Double-click **Start-Controller.cmd**. Keep its window running.
2. Open **http://localhost:8090** and sign in with the **operator key** printed in the window. Alternatively, run `npm run keys` to see all three keys.
3. Connect the ESP32 to this computer with a USB data cable. Open **Configure ESP32**, enter your 2.4 GHz Wi-Fi name/password, controller LAN address, GPIO pins, and relay polarity. The software inserts its device key automatically.
4. Select **Build firmware**, then **Refresh ports**, select your ESP32's COM port, check the replacement confirmation, and select **Upload to ESP32**. Local build tools are installed on this computer; on a fresh Windows installation, run **Setup-ESP32-Tools.cmd** first. See [USB setup](docs/USB-SETUP.md).
5. Connect the three output pins to a suitable driver and the signal tower. The dashboard shows **ESP32 connected** when the device reports back.
6. Connect the AI process using `integration-examples/ai_sender.py`. It submits each prediction automatically through the API; the ESP32 continuously fetches the next result. Select **Start line** once to arm processing. New cloths then process without any user upload and without an open browser.

The live dashboard shows an **AI result feed**, connection status, controls, and history. Its operator key cannot submit cloth results. The separate vision key belongs in the AI process. The controller service can run directly on the AI server, so the ESP32 fetches JSON from that server. See [continuous AI integration](docs/AI-INTEGRATION.md).

The controller starts **paused** every time it restarts. It preserves queued results and history. It interrupts an in-progress result rather than replaying it after a restart. The software reports GPIO state; it cannot detect a failed bulb, disconnected cable, or stuck relay without added feedback hardware.

## JSON format

```json
{"schema_version":1,"cloth_id":"CL-001","status":1,"confidence":0.97}
```

Only `cloth_id` and `status` are required. `status` accepts `1`, `2`, `3`, their string equivalents, or `defected`, `good`, `repairable`. `non-defected` is also accepted as good. Optional `confidence` is 0–1. Files may contain one result, an array of results, or `{"cloths":[...]}`. The maximum is 100 results and 256 KB per file. See [JSON and API details](docs/PROTOCOL.md).

## Folder map

```text
esp-code/                 ESP32 PlatformIO project and configuration template
arduino_ide/              Arduino IDE sketch, firmware copy and settings template
simulation/               Independent simulator server
working-software/src/     Live controller, authentication, queue, SQLite history
working-software/public/  Deployment dashboard mode
working-software/data/    Private keys and persistent database (created locally)
working-software/vision-inbox/  Vision files; processed/ and failed/ archives
shared/                   Dashboard design and JSON validation used by both systems
sample-json/              Single-result and batch examples
integration-examples/     Continuous AI sender, durable outbox, and integration demo
scripts/                  Access keys, integration sender, mock device
tests/                    Protocol, controller, sender and USB installer tests
docs/                     Wiring, deployment, integration and verification guides
.tools/                   Local firmware verification toolchain (ignored by Git)
videos/                   Main software and simulator demonstration MP4s
```

The interfaces share their design and validation rules, while their state and outputs remain independent.

For Arduino IDE, open `arduino_ide/arduino_ide.ino` and follow [its upload instructions](arduino_ide/README.md). Download your private configuration from the controller or copy/edit the configuration template before uploading.

## Demonstration videos

- [Main software demonstration](videos/Advanced-AI-Lab-Cloth-Scanner-Main-Software.mp4): 60 seconds covering automatic AI delivery, reported outputs, controls, history and firmware setup. Uses a clearly labelled mock ESP32 and example predictions; no physical USB upload.
- [Simulator demonstration](videos/Advanced-AI-Lab-Cloth-Scanner-Simulation.mp4): 33 seconds covering JSON input, signal changes and completed results.

Both videos show actual software interfaces. See [video details](videos/README.md).

## Verify and deploy

`npm test` runs the controller and protocol checks. `npm run mock-esp` runs an explicitly labelled software device for integration testing; stop it before connecting the real ESP32. The [verification guide](docs/VERIFICATION.md) includes hardware acceptance steps.

Docker deployment is included: `docker compose up -d --build`, then `docker compose exec cloth-controller node scripts/show-keys.js`. Data and vision input persist in the mounted folders. Keep port 8090 on a trusted local network: this version uses authenticated HTTP over LAN, without TLS. Do not expose it directly to the public Internet.

The built-in USB installer requires the desktop controller opened at localhost on the computer physically connected to the ESP32. The supplied Docker image supports operation and monitoring; it does not include the USB toolchain. Flash with the desktop installer or the manual PlatformIO workflow before deploying to Docker.

Firmware targets the classic **ESP32 DevKit / WROOM-32**, using the pinned [PlatformIO esp32dev board](https://docs.platformio.org/en/stable/boards/espressif32/esp32dev.html) and [ArduinoJson 7](https://arduinojson.org/v7/api/json/deserializejson/). Other ESP32 variants need their board definition and output pins adjusted.
