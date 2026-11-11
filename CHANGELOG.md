# Changelog

## Clean compact Android overlay

- Added explicit `?mode=overlay` and `?mode=debug` page modes. The floating page removes the developer panel and action menu from its DOM, hides textual diagnostics, and keeps the document/WebView background transparent.
- Added a separate full-screen Android `DebugActivity` opened from MainActivity. Its developer controls are touch-friendly, scrollable, grouped in collapsible sections, and visible without pressing a keyboard key.
- Replaced the overlay status chip with a 10 dp green/amber/red connection dot that appears on triple-tap. Added a centered loading spinner and moved model/page errors to Android Logcat and Recent diagnostics.
- Set the default compact window to 180 × 240 dp, exposed size settings in onboarding, and added temporary resizing around short speech bubbles and permission cards. Resizing preserves the window center; the camera refits to each viewport size and aspect ratio.
- Added projected model bounds from JavaScript and a small touch-proxy window so only the body/card area receives companion touch gestures while transparent regions pass through. Screen-wide movement uses a non-touchable overlay.
- Added a JavaScript `resizeWindow(widthDp, heightDp)` bridge and updated troubleshooting for phone debug mode, window sizing, and model load failures.
- Fixed `DebugActivity` to import `WebViewAssetLoader` from `androidx.webkit`, matching the declared AndroidX WebKit dependency.
- Added short explanations under each Android permission checklist item; status refresh continues on resume and while settings are being changed.

## Overlay state and visibility upgrade

- Fixed the invisible-model root cause: the GLB's centering translation was overwritten by the dock position. The imported scene now stays centered beneath a unit-scaled movement root, and entrance scaling applies only to the imported asset.
- Replaced click-anywhere movement with an explicit state machine. Empty-space clicks do nothing unless the developer-only target checkbox is enabled.
- Added persistent bottom-right docking, drag-to-reposition with localStorage persistence, tap reactions, and a small mascot action menu.
- Prevented the GLB's embedded one-frame `mixamo.com` pose from playing. The model is put in an A-pose before it is attached to the rendered scene.
- Added exact bone-name normalization for Mixamo names with or without colons and numeric suffixes, plus rest quaternion logging.
- Added optional FBX clip loading, retargeting, Hips root-motion removal, arm amplitude scaling, and 0.32 second mixer crossfades. The supplied repository has no FBX clips, so distinct spring-driven state poses are active by default.
- Added ordered walk, poke-at-contact, ripple, return-home, permission-card, timeout, greeting, idle micro-behavior, sleepy wake, blink, mouth, and microphone analyser behavior.
- Added a `D` developer panel with state tests, FPS/state timing, skeleton helper, bone axis sliders, mouth calibration, click-to-target opt-in, and a calibration JSON download.
- Added transparent ACES tone mapping, soft lighting, contact shadow, render pausing while hidden, and a persistent status/warning display.
- Synchronized Android window modes with the FSM: compact mascot dock at idle, full-screen passthrough during travel/poke/return, and touchable full-screen permission cards. Brain-server requests are forwarded into `window.ShinchanAPI`.

## Prior root causes

- The bundled `mixamo.com` animation is a one-frame pose and must not be played over procedural rig updates.
- The model's Mixamo bones have numeric suffixes and may arrive with sanitized prefixes; matching now strips those prefixes and suffixes before binding.
- Normal-screen pointer input previously initiated movement. The default input path is now inert outside the mascot and developer panel.

## Android first-run and server reliability

- Added a Gradle wrapper, Gradle properties, Java 17 settings, API 34 / min API 26 configuration, and AndroidX, OkHttp, WebKit, and coroutine dependencies.
- Replaced `file:///android_asset` loading with `WebViewAssetLoader` at `https://appassets.androidplatform.net/assets/overlay/`; enabled JavaScript, DOM storage, transparent hardware rendering, WebGL, autoplay, permission-gated microphone access, and Logcat/in-app console diagnostics.
- Added Android 13/14 notification and special-use foreground-service declarations, notification channel, persistent notification with Stop Shinchan action, network security config, and cleartext LAN WebSocket support.
- Rebuilt onboarding as a permission checklist with status refresh, server URL validation and `/health` test, emulator/Wi-Fi/USB hints, restricted Accessibility settings help, learning pause, excluded package list, diagnostics, local phone data clearing, and in-app tap-injection self-test.
- Added filtered on-device semantic traces, password and excluded-app protection, immediate touch-to-stop correction, WebSocket ping/reconnect backoff, and visible offline status while keeping the companion usable.
- Added pinned Python requirements, first-run Windows/Unix server launchers, `.env.example`, Gemini/Groq optional chat provider use, and a logged offline reply path with tolerant WebSocket parsing.
- Added a Rollup-only overlay build fallback for restricted hosts that prevent Vite/esbuild child processes; build-and-sync verifies the model and animation manifest in Android assets.
- Added beginner installation and ten-item troubleshooting instructions in `TROUBLESHOOTING.md`.
