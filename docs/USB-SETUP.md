# Install the program onto your ESP32

This workflow supports a classic ESP32 DevKit / WROOM-32. It builds the actual ESP32 program and uploads it through USB from the main software. The simulator does not flash hardware.

1. Start **Start-Controller.cmd** and keep it running. Open **http://localhost:8090** on that same computer and sign in using the operator key printed in the controller window.
2. Connect your ESP32 to that computer with a USB **data** cable. Keep the table line paused.
3. Select **Configure ESP32**. Enter the 2.4 GHz Wi-Fi network and password the ESP32 will use. Leave the password empty only for an open network.
4. Set **Controller LAN address** to the address the ESP32 can reach over Wi-Fi. The software suggests addresses for this computer. Do not use localhost here. Keep device ID `table-01` unless the controller has been configured for a different ID.
5. Select the output GPIOs and relay polarity matching your driver. Defaults are red 25, green 26, yellow 27, active LOW. The device access key is included automatically.
6. Select **1 · Build firmware**. Wait for **Ready to upload**. Expand **Build & upload log** for compiler progress or errors.
7. Select **Refresh ports** and choose the COM port belonging to your ESP32. If unsure, compare the list with the board disconnected and reconnected. The installer does not choose a port automatically.
8. Check **I selected my ESP32. Uploading will replace its existing program.** Select **2 · Upload to ESP32**. Keep USB connected until the upload completes.
9. The ESP32 restarts and joins Wi-Fi. Wait for **ESP32 connected** on the dashboard. Select **Start line** once; incoming AI results then drive the tower automatically.

After installation, operation uses Wi-Fi. USB can supply power if suitable for your board; the tower needs its own correctly rated supply and driver. Changing Wi-Fi, server address, pins or polarity requires a new build and upload. After restarting the controller, build again before uploading: previous job controls are not restored.

## If something does not work

| Message or symptom | Action |
| --- | --- |
| Firmware tools missing | Run **Setup-ESP32-Tools.cmd** from the project folder. Python 3.10+ and Internet access are required on a fresh computer. Tools are already installed in this workspace. |
| No serial devices detected | Try a USB data cable and another USB port. Confirm the board appears in Windows Device Manager. Install the USB serial driver appropriate to the chip on your board, from its manufacturer. |
| USB setup only available from localhost | Use the browser on the computer running the controller, at **http://localhost:8090**. Remote browsers cannot upload through their own USB ports using this installer. |
| Port busy or access denied | Close Arduino/PlatformIO serial monitors and other applications using that COM port; refresh and retry. |
| Connecting fails during upload | Verify the selected port. If your board needs manual bootloader entry, hold **BOOT** when the log shows Connecting, then release when writing begins. |
| Build fails | Read the log. The first setup needs Internet access to download the pinned toolchain and libraries. Correct settings, repair tools if needed, and build again. |
| Upload succeeds, ESP32 remains offline | Check Wi-Fi name/password, LAN address, controller firewall and Wi-Fi isolation. The server must remain running. Rebuild and upload corrected settings. |
| Settings changed | Build again before uploading, so the program matches the settings you entered. |

The supplied Docker image operates and monitors the table but does not include USB installation. Flash from a desktop installation or use the manual workflow described in [deployment](DEPLOYMENT.md), with the deployed controller's device key and address.

Build files are stored privately under `working-software/data/firmware/`. They contain the Wi-Fi password and device key; protect that folder and do not share it. Credentials are removed from the dashboard build log. **Download settings file** is an optional manual flashing export and contains the same private information.
