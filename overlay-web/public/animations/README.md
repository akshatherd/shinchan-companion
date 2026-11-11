# Optional Mixamo FBX animations

Place Mixamo FBX animation files in `overlay-web/public/animations/` and list each file in `manifest.json`. The state names are mapped by the `state` field, so the filenames below are the expected, easy-to-recognize names:

```json
{
  "animations": [
    { "state": "IDLE", "file": "idle.fbx", "timeScale": 1.0 },
    { "state": "BOOT_GREET", "file": "greet.fbx", "timeScale": 1.0 },
    { "state": "LISTENING", "file": "listen.fbx", "timeScale": 1.0 },
    { "state": "THINKING", "file": "think.fbx", "timeScale": 1.0 },
    { "state": "TALKING", "file": "talk.fbx", "timeScale": 1.0 },
    { "state": "WALK_TO_TARGET", "file": "walk.fbx", "timeScale": 1.0 },
    { "state": "POKE", "file": "poke.fbx", "timeScale": 1.0 },
    { "state": "ASK_PERMISSION", "file": "present.fbx", "timeScale": 1.0 },
    { "state": "PROUD", "file": "dance.fbx", "timeScale": 1.0 },
    { "state": "CONFUSED", "file": "confused.fbx", "timeScale": 1.0 },
    { "state": "SLEEPY", "file": "sleep.fbx", "timeScale": 1.0 }
  ]
}
```

Supported FSM states are `BOOT_GREET`, `IDLE`, `LISTENING`, `THINKING`, `TALKING`, `WALK_TO_TARGET`, `POKE`, `ASK_PERMISSION`, `PROUD`, `CONFUSED`, `SLEEPY`, and `RETURN_HOME`. Tracks are retargeted to the GLB's suffixed Mixamo bone names. Unmatched tracks are reported in the console. Root Hips position tracks are removed so root motion stays under the controller's movement system. If a state has no FBX clip, its spring-driven procedural pose remains active.

Expected optional filenames are `idle.fbx`, `greet.fbx`, `listen.fbx`, `think.fbx`, `talk.fbx`, `walk.fbx`, `poke.fbx`, `present.fbx`, `dance.fbx`, `confused.fbx`, and `sleep.fbx`. `RETURN_HOME` reuses `walk.fbx`. The manifest starts empty because these clips are not bundled with the supplied GLB.
