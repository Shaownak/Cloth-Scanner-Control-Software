# Upload with Arduino IDE

Open **arduino_ide.ino** in Arduino IDE. Keep all files in the **arduino_ide** folder together, so the sketch file and folder names match. The sketch entry file is intentionally empty apart from comments; Arduino compiles the complete firmware in **main.cpp** alongside it.

1. In Boards Manager, install **esp32 by Espressif Systems**, version **2.0.17**.
2. In Library Manager, install **ArduinoJson**, version **7.4.2**.
3. Create **table_config.h** by downloading it from the main software's **Configure ESP32 → Download settings file**, or copy **table_config.example.h** to **table_config.h** and edit the Wi-Fi name/password, controller LAN address and device key yourself. Private configuration files are excluded from Git. Use the device key, not the operator or vision key. Keep device ID and output pins consistent with your controller and wiring.
4. Connect your classic ESP32 DevKit / WROOM-32 by USB. Select **ESP32 Dev Module** and its COM port in Arduino IDE.
5. Click **Verify**, then **Upload**. Close other serial monitors using the port. If your board requires it, hold BOOT when the upload shows Connecting and release when writing begins.
6. Open Serial Monitor at **115200 baud** to check startup. Keep the main controller running; wait for **ESP32 connected**, then select **Start line**.

Default outputs: status 1 → red/GPIO25, status 2 → green/GPIO26, status 3 → yellow/GPIO27. Relay polarity defaults to active LOW. The tower requires an appropriate external driver and its own rated supply.

Placeholder settings keep the outputs off and do not connect to your controller. The software uses Wi-Fi after installation; USB is for programming and, if suitable for your board, power. Protect your configured **table_config.h**, which contains the Wi-Fi password and device key.

**main.cpp** is a copy of **esp-code/src/main.cpp** as supplied with this version. If the firmware is updated later, copy the updated source here before using Arduino IDE again. The main software's USB installer builds from **esp-code/**, so editing this Arduino copy does not change that installer.

The same firmware source has passed a PlatformIO build using these dependency versions. Uploading through Arduino IDE and physical board operation have not yet been verified on connected hardware.
