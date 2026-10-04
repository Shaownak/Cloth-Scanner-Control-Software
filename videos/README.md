# Simulation demonstration video

## Main software demonstration

Open **Advanced-AI-Lab-Cloth-Scanner-Main-Software.mp4** for a 60-second, 1080p demonstration of the deployable controller. It shows operator access, automatic per-cloth AI delivery, device reports, pause controls, completed history, ESP32 configuration, a real firmware build, USB installation controls and the AI integration endpoint.

The main software was exercised on an isolated local instance at port 8092, with separate private data. The mock device reports **MOCK-1.0.0**. Predictions are sample classifications delivered through the real authenticated vision API; no vision model or physical ESP32 was used. Example Wi-Fi settings were compiled successfully, but no USB upload or real GPIO operation was performed. Production controller data at port 8090 was not used or changed.

The demonstration uses actual browser captures sampled twice per second, encoded at 30 fps without audio. The preview is **main-software-preview.jpg**. Re-render captured frames using **scripts/create-simulation-video.py --main**. **scripts/main-software-video-demo.js** runs the isolated API demonstration with a mock device; stop it when finished.

## Simulator demonstration

Open **Advanced-AI-Lab-Cloth-Scanner-Simulation.mp4** to watch the working simulator.

The video shows the actual browser interface, loading the built-in four-cloth JSON sample, processing green → red → yellow → green, returning to all lights off, and the completed inspection history. The playback uses five seconds per inspection.

This is a software simulation with a virtual ESP32 and tower. It does not show a physical ESP32 or real lamps. Captures were sampled twice per second; the captioned MP4 is encoded at 1920×1080 and 30 fps, without audio. The duration is approximately 33 seconds.

**simulation-preview.jpg** is a still preview. Captured screenshots and their observed status metadata are kept in **simulation-frames/**. The rendering script is **scripts/create-simulation-video.py**; it uses the workspace Python runtime with Pillow and the local encoder in **.tools/video-deps/**.
