# Build, install, run, and troubleshoot

## First build checklist

- [ ] Install Android Studio and select JDK 17 in **Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK**.
- [ ] In SDK Manager, install **Android SDK Platform 34**. Android Gradle Plugin installs its default Build Tools as part of Gradle sync if needed.
- [ ] Install Node.js 20+ and npm.
- [ ] Run `build-and-sync.bat` from the repository folder on Windows, or `sh build-and-sync.sh` on macOS/Linux. Wait for “Overlay built and synced to Android assets.” The script checks that `models/shinchan.glb` and `animations/manifest.json` landed in Android assets. If Vite/esbuild cannot start in a restricted environment, it automatically uses the included Rollup fallback.
- [ ] Open the `android-app/` folder in Android Studio and let Gradle sync finish. The first sync needs an internet connection to download Gradle and Android dependencies.
- [ ] Choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The debug APK is `android-app/app/build/outputs/apk/debug/app-debug.apk`.
- [ ] Command-line alternative: from `android-app/`, run `gradlew.bat assembleDebug` on Windows; on macOS/Linux run `chmod +x gradlew` once, then `./gradlew assembleDebug`.
- [ ] Install it from Android Studio's APK notification, or run `adb install -r app/build/outputs/apk/debug/app-debug.apk` from `android-app/`.
- [ ] Open Shinchan MUSE, set the Brain server URL, then follow the checklist. The overlay permission is needed to summon Shinchan. Accessibility is needed only for approved tap injection and filtered UI traces.

## Start the server

1. On the computer, run `brain-server/run-server.bat` (Windows) or `sh brain-server/run-server.sh` (macOS/Linux). The first run creates a Python virtual environment, installs pinned packages, and starts the server on port 8000.
2. Check `http://127.0.0.1:8000/health` in a browser. It should return JSON with `"status":"ok"`. Interactive API docs are at `http://127.0.0.1:8000/docs`.
3. Optional: put `GEMINI_API_KEY` or `GROQ_API_KEY` in `brain-server/.env`. Without either key, the server logs that offline replies are enabled and continues to run.

## Connect Android

- **Emulator:** use `ws://10.0.2.2:8000/ws/companion`.
- **Phone over Wi-Fi:** connect phone and computer to the same network, set the URL to `ws://<computer-LAN-IP>:8000/ws/companion`, and allow inbound TCP 8000 through the computer firewall. Find the LAN IP with `ipconfig` on Windows or `ip addr` on Linux.
- **Phone over USB:** enable USB debugging, connect the phone, then run `adb reverse tcp:8000 tcp:8000`. Set the app URL to `ws://localhost:8000/ws/companion`.
- In the app, tap **Test Connection**. The checklist's server row should turn green. The overlay stays usable offline and shows a “can't reach my brain” bubble when the server is unavailable.

## Android permissions and self-test

- **Display over other apps:** setup checklist > Overlay permission > allow Shinchan MUSE > return to the app and tap Summon.
- **Accessibility:** setup checklist > Accessibility service > Shinchan MUSE > turn on. If Android greys out the switch, return and tap **Open this app's App Info**, then **⋮ > Allow restricted settings**, and try again.
- **Tap injection:** with Accessibility enabled, tap **Run self-test**. Shinchan should tap the harmless blue target in this screen. Real user touches interrupt an active routine and send a negative correction.
- **Microphone:** optional. Grant it only if you enable the microphone analyser in **Open Debug View**.
- **Notifications:** allow notifications so Android can show the persistent foreground-service notification. Its **Stop Shinchan** action closes the overlay.
- **Battery settings:** some phone manufacturers stop overlays in the background. If that happens, allow background operation or exclude Shinchan MUSE from battery optimization.

## Top 10 errors and fixes

1. **`SDK location not found` or missing `android-34`:** install Android SDK Platform 34 in Android Studio's SDK Manager. Confirm Android Studio's Android SDK Location points at the installed SDK, then let Gradle sync install the Build Tools version it requests.
2. **Gradle cannot find Java / unsupported Java version:** install JDK 17 and select it as the Gradle JDK. Close and reopen Android Studio after changing it.
3. **Gradle download or dependency resolution fails:** reconnect to the internet, check proxy/firewall settings, then use Android Studio **Sync Project with Gradle Files** again.
4. **`build-and-sync` says `npm` is not recognized:** install Node.js 20+, restart the terminal, and run `node --version` and `npm --version` before retrying.
5. **Vite build succeeds but Shinchan model is missing:** rerun `build-and-sync`; confirm `overlay-web/public/models/shinchan.glb` exists and the output asset `android-app/app/src/main/assets/overlay/models/shinchan.glb` is non-empty.
6. **App says overlay permission is missing or the mascot does not appear:** enable **Display over other apps** for Shinchan MUSE, return to onboarding, and tap Summon again. Android may revoke this after reinstall.
7. **Accessibility switch is disabled/greyed out:** open App Info > ⋮ > **Allow restricted settings**, then reopen Accessibility settings. This is an Android sideloading restriction.
8. **Server row stays red on a physical phone:** do not use `127.0.0.1` or `10.0.2.2` over Wi-Fi. Use the computer's LAN IP, same Wi-Fi, open TCP 8000 in the firewall, and check `/health` on the computer.
9. **USB connection fails:** verify `adb devices` lists the phone, run `adb reverse tcp:8000 tcp:8000` again after reconnecting the cable, and use the exact `ws://localhost:8000/ws/companion` URL.
10. **Self-test fails, microphone is silent, or Android stops the overlay:** verify the matching Accessibility/Microphone/Notification permission, check the in-app Recent diagnostics and Logcat tag `ShinchanMUSE`, disable battery optimization for testing, then restart the service.

## Diagnostics

The compact overlay contains only Shinchan, his short speech bubbles, permission cards, and a small connection dot. Triple-tap Shinchan to show or hide that dot. It does not contain the developer panel or status text. Use the onboarding screen's **Open Debug View** button for the full-screen touch-friendly developer controls; sections collapse, buttons are at least 48 dp high, and the panel opens without a keyboard.

The onboarding screen's **Recent diagnostics** and Android Studio Logcat tag `ShinchanMUSE` show model load failures, WebView console messages, and service errors. The overlay page uses `WebViewAssetLoader`; if the model loader fails, the compact window logs the failure without showing an error toast over other apps. Loading is indicated with a small spinner. The normal window starts at 180 × 240 dp and can be changed under **Compact overlay size**. It expands temporarily for short speech bubbles and permission cards, then returns to the configured size.

The overlay touch window follows the model's projected screen bounds. Touches inside the character area reach Shinchan; the transparent area outside that bounds window passes through to the app underneath. During screen-wide walk and poke actions, the overlay is non-touchable so it does not prevent the approved tap routine. On Android 12 and newer, Android limits pass-through touches from application overlays by their combined opacity, so the rendered window uses a 0.79 alpha and the tiny touch proxy uses 0.01.

If you still see developer controls in the floating window, stop and summon Shinchan again so Android loads the updated bundled `assets/overlay/index.html`. Run `build-and-sync.bat` after changing `overlay-web` sources, then rebuild/install the APK.
