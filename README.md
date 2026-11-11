# Shinchan MUSE

Shinchan MUSE contains a transparent Three.js companion, a local FastAPI brain server, and an Android overlay app. The Android app loads the bundled web build through AndroidX WebViewAssetLoader, uses Android's foreground service for the overlay, and uses Accessibility only for user-approved tap injection and filtered semantic traces.

## Build and install on Android

1. Install Android Studio, JDK 17, and Android SDK Platform 34. Android Gradle Plugin downloads its default Build Tools if they are not installed.
2. In a terminal at this folder, run `build-and-sync.bat` on Windows or `sh build-and-sync.sh` on macOS/Linux. This builds the Vite app and copies the model and animation files into Android assets.
3. Open `android-app/` in Android Studio and choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**, or run `cd android-app` then `gradlew.bat assembleDebug` on Windows / `chmod +x gradlew && ./gradlew assembleDebug` on macOS/Linux.
4. Install `android-app/app/build/outputs/apk/debug/app-debug.apk`. Open the app and follow its setup checklist. Grant overlay permission to show the mascot. Accessibility, microphone, notifications, and battery settings are optional until their features are used.

## Start the brain server

Run `brain-server/run-server.bat` on Windows or `sh brain-server/run-server.sh` on macOS/Linux. The script creates `.venv`, installs pinned requirements, copies `.env.example` to `.env` if needed, and starts FastAPI at `http://0.0.0.0:8000`. Check `http://127.0.0.1:8000/health` or open `/docs` in a browser. With no Gemini or Groq key, the server logs that offline friend replies are active. Put an optional key in `brain-server/.env` to enable provider-backed chat.

## Connect the phone

- Android emulator: `ws://10.0.2.2:8000/ws/companion`
- Physical phone on the same Wi-Fi: `ws://<computer-LAN-IP>:8000/ws/companion`; allow TCP port 8000 through the computer firewall.
- USB: run `adb reverse tcp:8000 tcp:8000`, then use `ws://localhost:8000/ws/companion`.

The app checks `/health`, reconnects its WebSocket with backoff, and remains usable in offline mode. Plain `ws://` is intended for trusted local networks; use `wss://` when traffic crosses an untrusted network.

The floating page is transparent and starts at 180 × 240 dp. Use **Compact overlay size** in MainActivity to change the window dimensions. It shows the mascot, short speech bubbles, permission cards, and an optional connection dot. **Open Debug View** opens a separate full-screen page with touch-friendly state tests, FPS, skeleton controls, and calibration sliders; it does not require a keyboard.

## Animation clips

The supplied GLB's embedded one-frame pose is disabled. The companion uses its spring-driven A-pose state fallback. To add Mixamo FBX clips, put them under `overlay-web/public/animations/` and list them in `manifest.json`. Expected optional names include `idle.fbx`, `greet.fbx`, `listen.fbx`, `think.fbx`, `talk.fbx`, `walk.fbx`, `poke.fbx`, `present.fbx`, `dance.fbx`, `confused.fbx`, and `sleep.fbx`.

Read [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for step-by-step build, permission, server, and device instructions.
