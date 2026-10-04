# ESP32 tower firmware

For the built-in installer, connect the ESP32 by USB, open the desktop controller at **http://localhost:8090**, and select **Configure ESP32 → Build firmware → Upload to ESP32**. Enter Wi-Fi and output settings, select the connected port, and confirm firmware replacement. The software inserts its device key and builds an isolated project automatically. See [USB setup](../docs/USB-SETUP.md).

For manual flashing, copy `include/table_config.example.h` to `include/table_config.h` and edit it, or download the private header from **Device & setup**. Use your controller computer's LAN IP and the device key. The source is `src/main.cpp`; the PlatformIO project is `platformio.ini`.

Default mapping: 1 → red/GPIO25, 2 → green/GPIO26, 3 → yellow/GPIO27. Default polarity is active LOW. Output 0 turns all channels off. Use a compatible external driver, never connect the tower load directly to GPIO.

Build: `pio run`. Flash: `pio run -t upload --upload-port COM5`. Serial monitor: `pio device monitor --port COM5 --baud 115200`. Run these from this folder, replacing COM5 with your ESP32 port. Missing/unconfigured settings leave outputs off. Rebuild after configuring; a binary built from the placeholder template is not a connected deployment.

See [deployment and wiring](../docs/DEPLOYMENT.md) for setup, pin assumptions, fault behavior, and the hardware acceptance sequence.
