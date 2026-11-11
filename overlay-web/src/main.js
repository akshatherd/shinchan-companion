import * as THREE from 'three';
import { ShinchanRigController } from './ShinchanRigController.js';
import { CLIP_NAMES } from './ClipLibrary.js';
import { AutonomyDirector } from './AutonomyDirector.js';

const scene = new THREE.Scene();
const pageMode = new URLSearchParams(window.location.search).get('mode') === 'debug' ? 'debug' : 'overlay';
document.documentElement.classList.add(`${pageMode}-mode`);
const camera = new THREE.PerspectiveCamera(38, Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight), 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.id = 'shinchan-canvas';
renderer.domElement.style.cssText = 'position:fixed;inset:0;display:block;z-index:0;touch-action:none;';
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x56403a, 1.6));
const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2); keyLight.position.set(-3, 4, 7); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9fc9ff, 1.1); rimLight.position.set(3, 1, -4); scene.add(rimLight);

const style = document.createElement('style');
style.textContent = `
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}
  #shinchan-canvas{pointer-events:auto}
  #sc-status{position:fixed;left:10px;top:10px;z-index:10000;padding:6px 9px;border-radius:8px;background:#0f172add;color:#fff;font:11px system-ui;pointer-events:none;max-width:min(70vw,520px)}
  #sc-bubble{position:fixed;left:50%;top:16px;transform:translate(-50%,-8px) scale(.9);opacity:0;z-index:9998;max-width:min(80vw,480px);padding:10px 15px;border:2px solid #facc15;border-radius:20px;background:#101827ed;color:white;font:600 14px system-ui;box-shadow:0 8px 25px #0003;pointer-events:none;transition:transform .24s cubic-bezier(.2,1.6,.3,1),opacity .2s}
  #sc-bubble.visible{transform:translate(-50%,0) scale(1);opacity:1}
  #sc-listening{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9995;display:none;padding:7px 11px;border-radius:16px;background:#0f172add;color:#fff;font:600 12px system-ui;pointer-events:none}
  #sc-listening.visible{display:block}
  #sc-debug-toggle{position:fixed;right:10px;top:10px;z-index:10002;border:1px solid #64748b;border-radius:9px;background:#0f172add;color:#fff;padding:7px 10px;font:600 12px system-ui}
  #sc-debug{position:fixed;right:10px;top:48px;bottom:10px;z-index:10001;width:min(370px,92vw);overflow:auto;display:none;padding:12px;border:1px solid #64748b;border-radius:14px;background:#0f172af2;color:#f8fafc;font:12px system-ui;box-shadow:0 12px 34px #0005;overscroll-behavior:contain}
  #sc-debug.open{display:block}#sc-debug h3{margin:4px 0 10px;font-size:15px}#sc-debug .row{display:flex;align-items:center;gap:8px;margin:7px 0}#sc-debug .row label{flex:1}#sc-debug button,#sc-action-menu button{border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f8fafc;padding:7px 9px;font:600 12px system-ui;cursor:pointer}#sc-debug button:hover,#sc-action-menu button:hover{background:#334155}#sc-debug .buttons{display:flex;gap:5px;flex-wrap:wrap}#sc-debug input[type=range]{width:110px}#sc-debug .bone{padding:7px 0;border-top:1px solid #334155}#sc-debug .bone strong{display:block;margin-bottom:3px}#sc-debug .bone label{display:flex;justify-content:space-between;gap:8px}
  #sc-action-menu{position:fixed;z-index:9999;display:none;gap:6px;padding:8px;border-radius:12px;background:#0f172aee;box-shadow:0 6px 20px #0004}#sc-action-menu.open{display:flex}
  #sc-timeout{height:5px;border-radius:8px;background:#22c55e;transform-origin:left;transition:transform .1s linear}
  #sc-permission{position:fixed;left:50%;bottom:20px;z-index:9997;transform:translateX(-50%);display:none;min-width:220px;padding:9px 12px;border-radius:10px;background:#101827e8;color:#fff;font:600 12px system-ui;pointer-events:none}#sc-permission.open{display:block}
  #sc-warnings{color:#fbbf24;white-space:normal}
`;
document.head.appendChild(style);
style.textContent += `
  #sc-connection-dot{position:fixed;left:50%;top:8px;z-index:9996;width:10px;height:10px;border:1px solid #ffffffaa;border-radius:50%;background:#f59e0b;box-shadow:0 0 8px #0008;pointer-events:none;opacity:0;transition:opacity .15s}
  #sc-connection-dot.visible{opacity:1}#sc-connection-dot.connected{background:#22c55e}#sc-connection-dot.offline{background:#ef4444}#sc-connection-dot.connecting{background:#f59e0b}
  #sc-loading{position:fixed;left:50%;top:50%;z-index:9996;width:24px;height:24px;margin:-12px;border:3px solid #ffffff66;border-top-color:#facc15;border-radius:50%;animation:sc-spin .8s linear infinite;pointer-events:none}
  @keyframes sc-spin{to{transform:rotate(360deg)}}
  .overlay-mode,.overlay-mode body{background:transparent!important}
  .overlay-mode #sc-status,.overlay-mode #sc-debug-toggle,.overlay-mode #sc-debug,.overlay-mode #sc-permission{display:none!important}
  .debug-mode,.debug-mode body{background:#0f172a!important}.debug-mode #sc-debug{display:block}
  .debug-mode #sc-debug.closed{display:none}
  #sc-debug-toggle{min-height:48px;padding:10px 14px;font-size:16px}
  #sc-debug{inset:10px 10px 10px auto;width:min(520px,94vw);padding:16px;font-size:15px;-webkit-overflow-scrolling:touch}
  #sc-debug button,#sc-debug input[type=text]{min-height:48px;font-size:15px;touch-action:manipulation}
  #sc-debug input[type=range]{width:min(180px,40vw);min-height:36px;touch-action:pan-x}
  #sc-debug .row{gap:10px;margin:10px 0;flex-wrap:wrap}#sc-debug .row label{min-width:140px}
  #sc-debug details{border-top:1px solid #475569;padding-top:6px;margin-top:8px}#sc-debug summary{min-height:48px;display:flex;align-items:center;font-weight:700;font-size:17px;touch-action:manipulation}
  #sc-bubble{max-width:min(92vw,480px);font-size:15px;overflow-wrap:anywhere}
`;

const status = document.createElement('div'); status.id = 'sc-status'; status.textContent = 'Shinchan: loading model…'; document.body.appendChild(status);
const connectionDot = document.createElement('div'); connectionDot.id = 'sc-connection-dot'; document.body.appendChild(connectionDot);
const loading = document.createElement('div'); loading.id = 'sc-loading'; document.body.appendChild(loading);
const listeningIndicator = document.createElement('div'); listeningIndicator.id = 'sc-listening'; listeningIndicator.textContent = '🎙 Listening…'; document.body.appendChild(listeningIndicator);
const bubble = document.createElement('div'); bubble.id = 'sc-bubble'; document.body.appendChild(bubble);
const toggle = document.createElement('button'); toggle.id = 'sc-debug-toggle'; toggle.textContent = 'Debug (D)'; document.body.appendChild(toggle);
const debug = document.createElement('aside'); debug.id = 'sc-debug'; debug.innerHTML = `
  <h3>Shinchan MUSE · developer panel</h3>
  <button id="sc-debug-close" type="button">Hide developer panel</button>
  <details open><summary>States and diagnostics</summary><div id="sc-state-readout">State: BOOT_GREET</div><div id="sc-fps">FPS: —</div><div id="sc-animation">Animation: loading</div><div id="sc-warnings"></div><div class="buttons" id="sc-state-buttons"></div></details>
  <details><summary>Rig calibration</summary>
  <div class="row"><label for="sc-arm-amplitude">Arm clip amplitude</label><input id="sc-arm-amplitude" type="range" min="0" max="1" step="0.05" value="0.6"><span id="sc-arm-value">0.60</span></div>
  <div class="row"><label><input id="sc-click-target" type="checkbox"> Click to set poke target</label></div>
  <div class="row"><label><input id="sc-skeleton" type="checkbox"> Show skeleton helper</label></div>
  <div class="row"><label for="sc-mouth-x">Mouth X</label><input id="sc-mouth-x" type="range" min="-0.3" max="0.3" step="0.005" value="0"><span id="sc-mouth-x-value">0</span></div>
  <div class="row"><label for="sc-mouth-y">Mouth Y</label><input id="sc-mouth-y" type="range" min="-0.35" max="0.25" step="0.005" value="-0.12"><span id="sc-mouth-y-value">-0.12</span></div>
  <div class="row"><label for="sc-mouth-z">Mouth Z</label><input id="sc-mouth-z" type="range" min="0" max="0.5" step="0.005" value="0.24"><span id="sc-mouth-z-value">0.24</span></div>
  <div class="row"><label for="sc-mouth-width">Mouth width</label><input id="sc-mouth-width" type="range" min="0.04" max="0.3" step="0.005" value="0.11"></div>
  <div class="row"><label for="sc-mouth-height">Mouth height</label><input id="sc-mouth-height" type="range" min="0.02" max="0.16" step="0.005" value="0.045"></div></details>
  <details><summary>Voice and greeting</summary><div class="row"><button id="sc-mic">Enable microphone analyser</button><button id="sc-dump">Dump calibrated offsets as JSON</button></div>
  <div class="row"><label>Greeting</label><input id="sc-greeting" type="text" maxlength="100" style="width:190px"><button id="sc-save-greeting">Save</button></div></details>
  <details><summary>Bone axis calibration</summary><div id="sc-bone-sliders"></div></details>
`;
document.body.appendChild(debug);
const actionMenu = document.createElement('div'); actionMenu.id = 'sc-action-menu';
actionMenu.innerHTML = '<button data-action="talk">Talk</button><button data-action="permission">Ask me first</button>';
document.body.appendChild(actionMenu);
const permissionUi = document.createElement('div'); permissionUi.id = 'sc-permission'; permissionUi.innerHTML = '<div id="sc-permission-text"></div><div id="sc-timeout" style="margin-top:7px;width:100%"></div>';
document.body.appendChild(permissionUi);
if (pageMode === 'overlay') { toggle.remove(); debug.remove(); actionMenu.remove(); permissionUi.remove(); }

const rig = new ShinchanRigController(scene, camera, {
  onState: (state, params) => {
    updateStateReadout();
    if (window.AndroidBridge?.stateChanged) window.AndroidBridge.stateChanged(state);
    if (state === 'ASK_PERMISSION') { const prompt = params.prompt || params.promptText || 'Should I do this?'; showPermissionUi(prompt); say(prompt); }
    else hidePermissionUi();
  },
  onWarning: (message) => { const node = document.getElementById('sc-warnings'); if (node) node.textContent = message; },
  onPermissionResult: (result) => { if (!window.AndroidBridge?.permissionResult) sendBackend(result); },
  onPoke: (point) => window.dispatchEvent(new CustomEvent('shinchan:poke-complete', { detail: point }))
});
const autonomy = new AutonomyDirector({ requestState: (state, params) => rig.requestState(state, params), showBubble: (text) => say(text) });

function updateStateReadout() {
  const stateNode = document.getElementById('sc-state-readout');
  if (stateNode) stateNode.textContent = `State: ${rig.state} · ${rig.stateTimer.toFixed(1)}s`;
  const animNode = document.getElementById('sc-animation');
  if (animNode) animNode.textContent = `Clip: ${rig.activeClipName || 'idle_breathe'}`;
}
function sendBackend(message) {
  try { window.AndroidBridge?.sendToServer?.(JSON.stringify(message)); } catch (error) { console.warn('[Shinchan] backend bridge send failed', error); }
  window.dispatchEvent(new CustomEvent('shinchan:backend-message', { detail: message }));
}
let pendingStateRequest = null;
function resumePendingState() {
  if (!pendingStateRequest) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!pendingStateRequest) return;
    const pending = pendingStateRequest; pendingStateRequest = null;
    rig.requestState(pending.name, pending.params);
  }));
}
function requestState(name, params = {}) {
  const canonical = name === 'WALK' || name === 'WALK_AND_POKE' ? 'WALK_TO_TARGET' : name;
  if (window.AndroidBridge?.setOverlayMode && ['WALK_TO_TARGET', 'ASK_PERMISSION'].includes(canonical)) {
    pendingStateRequest = { name: canonical, params };
    window.AndroidBridge.setOverlayMode(canonical === 'ASK_PERMISSION' ? 'permission' : 'expanded');
    window.setTimeout(resumePendingState, 220);
    return true;
  }
  return rig.requestState(canonical, params);
}

const stateButtons = [
  ['Idle', 'IDLE'], ['Listen', 'LISTENING'], ['Think', 'THINKING'], ['Walk & Poke', 'WALK_TO_TARGET'],
  ['Hold 2 Cards', 'ASK_PERMISSION'], ['Wiggle Dance', 'PROUD'], ['Confused', 'CONFUSED'], ['Sleepy', 'SLEEPY'], ['Talk Test', 'TALKING']
];
const buttonsHost = debug.querySelector('#sc-state-buttons');
for (const [label, state] of stateButtons) {
  const button = document.createElement('button'); button.textContent = label; button.dataset.state = state; buttonsHost.appendChild(button);
}
for (const clipName of CLIP_NAMES) {
  const button = document.createElement('button'); button.textContent = clipName.replaceAll('_', ' '); button.dataset.state = clipName;
  buttonsHost.appendChild(button);
}

let bubbleQueue = []; let bubbleTimer = 0; let utterance = null; let permissionExpanded = false;
function say(message, { speech = false, duration = 3600 } = {}) {
  message = String(message).slice(0, 110);
  duration = Math.min(4200, Math.max(900, duration));
  bubbleQueue.push({ message, speech, duration });
  if (bubbleTimer) return;
  const showNext = () => {
    const item = bubbleQueue.shift(); if (!item) { bubble.classList.remove('visible'); bubbleTimer = 0; if (rig.state !== 'ASK_PERMISSION' && !['WALK_TO_TARGET', 'POKE', 'RETURN_HOME'].includes(rig.state)) window.AndroidBridge?.resizeWindow?.(0, 0); return; }
    bubble.textContent = item.message; bubble.classList.add('visible');
    if (rig.state === 'ASK_PERMISSION') window.AndroidBridge?.resizeWindow?.(320, 360);
    else if (!['WALK_TO_TARGET', 'POKE', 'RETURN_HOME'].includes(rig.state)) window.AndroidBridge?.resizeWindow?.(280, 320);
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(showNext, item.duration);
    if (item.speech && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel(); utterance = new SpeechSynthesisUtterance(item.message);
      utterance.onstart = () => rig.requestState('TALKING', { duration: Math.max(2, item.duration / 1000) });
      utterance.onend = () => { if (rig.state === 'TALKING') rig.requestState('IDLE', { force: true }); };
      utterance.onerror = () => { if (rig.state === 'TALKING') rig.requestState('IDLE', { force: true }); };
      window.speechSynthesis.speak(utterance);
    }
  };
  showNext();
}

function showPermissionUi(text) {
  if (pageMode === 'debug') {
    const promptNode = document.getElementById('sc-permission-text');
    if (promptNode) promptNode.textContent = text;
    permissionUi.classList.add('open');
  } else { permissionExpanded = true; window.AndroidBridge?.resizeWindow?.(320, 360); }
  const bar = document.getElementById('sc-timeout'); if (bar) bar.style.transform = 'scaleX(1)';
}
function hidePermissionUi() { permissionUi.classList.remove('open'); if (permissionExpanded && !['WALK_TO_TARGET', 'POKE', 'RETURN_HOME'].includes(rig.state)) { permissionExpanded = false; window.AndroidBridge?.resizeWindow?.(0, 0); } }

function updateStatus() {
  if (!rig.model) return;
  const diag = rig.getDiagnostics();
  const brain = window.__shinchanConnectionStatus || (window.AndroidBridge ? 'Connecting' : 'Local preview');
  status.textContent = `Shinchan: ready · Brain: ${brain} · ${diag.meshes} meshes · ${diag.bones} bones`;
  status.style.background = diag.animationWarning ? '#854d0edd' : '#166534dd';
  connectionDot.classList.remove('connected', 'offline', 'connecting');
  connectionDot.classList.add(brain === 'Connected' ? 'connected' : brain === 'Offline' ? 'offline' : 'connecting');
  updateStateReadout();
}

// Public API: external bridge and WebSocket messages may request a state, but
// the state machine remains the sole writer of the character pose.
window.ShinchanAPI = {
  requestState,
  resumePendingState,
  getDiagnostics() { return rig.getDiagnostics(); },
  say(message, options) { say(String(message), options); },
  onEvent(event) { autonomy.handle(event || {}); return true; },
  onTap(payload = {}) {
    listeningIndicator.classList.add('visible');
    if (Number.isFinite(payload.x) && Number.isFinite(payload.y)) window.AndroidBridge?.reportPageTap?.(payload.x, payload.y);
    rig.requestState('LISTENING', { force: true });
    return true;
  },
  onLongPress() { rig.requestState('CONFUSED', { force: true }); return true; },
  onDoubleTap() { rig.requestState('dance_silly', { force: true }); return true; },
  onDrag() { return true; },
  onBridgeTest() { return window.AndroidBridge?.healthPing?.() === 'ok'; },
  onTtsStart() { listeningIndicator.classList.remove('visible'); rig.requestState('TALKING', { force: true }); },
  onTtsDone() { listeningIndicator.classList.remove('visible'); rig.requestState('IDLE', { force: true }); },
  onTtsError() { listeningIndicator.classList.remove('visible'); say('I cannot speak right now, but I am still here.'); rig.requestState('IDLE', { force: true }); },
  setConnectionStatus(connection) {
    const next = String(connection || 'Offline');
    const previous = window.__shinchanConnectionStatus;
    window.__shinchanConnectionStatus = next;
    if (rig.model) updateStatus();
    else status.textContent = `Shinchan: loading · Brain: ${next}`;
    if (next === 'Offline' && previous !== 'Offline') say("I can't reach my brain, but I'm still here.", { duration: 3200 });
  },
  startMicrophone() { return rig.startMicrophone(); },
  stopMicrophone() { rig.stopMicrophone(); }
};
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'STATE' || message.type === 'REQUEST_STATE') window.ShinchanAPI.requestState(message.state || message.name, message.params || message);
  if (message.type === 'ASK_PERMISSION') window.ShinchanAPI.requestState('ASK_PERMISSION', message);
  if (message.type === 'WALK_TO_TARGET' || message.type === 'WALK_AND_POKE') window.ShinchanAPI.requestState('WALK_TO_TARGET', message);
  if (message.type === 'CHAT_REPLY' && message.text) say(String(message.text), { speech: true });
  if (message.type === 'CONNECTION_STATUS') window.ShinchanAPI.setConnectionStatus(message.connected ? 'Connected' : 'Offline');
  if (message.type === 'AUTONOMY_EVENT') autonomy.handle(message);
  if (message.type === 'VOICE_REPLY' && message.text) { say(String(message.text)); rig.requestState('TALKING', { duration: Math.min(12, String(message.text).length * 0.09), force: true }); }
  if (message.type === 'VOICE_PROGRESS') window.ShinchanAPI[message.event]?.();
});
window.addEventListener('shinchan:request-state', (event) => window.ShinchanAPI.requestState(event.detail?.name, event.detail?.params || {}));

toggle.addEventListener('click', () => debug.classList.toggle('closed'));
debug.querySelector('#sc-debug-close').addEventListener('click', () => debug.classList.add('closed'));
window.addEventListener('keydown', (event) => { if (pageMode !== 'debug' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; if (event.key.toLowerCase() === 'd' && !event.ctrlKey && !event.metaKey && !event.altKey) debug.classList.toggle('closed'); });
debug.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-state]');
  if (button) {
    const state = button.dataset.state;
    if (state === 'WALK_TO_TARGET') requestState(state, { x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 });
    else if (state === 'ASK_PERMISSION') requestState(state, { prompt: 'May I tap this test target?', actionId: `test-${Date.now()}` });
    else if (state === 'TALKING') say('Hey! I am Shinchan. I can listen and move when you ask.', { speech: true });
    else if (state === 'LISTENING') rig.startMicrophone().then(() => requestState(state, { force: true })).catch((error) => { requestState(state, { force: true }); say(error.message); });
    else requestState(state, state === 'PROUD' ? { duration: 2.2, force: true } : { force: true });
    return;
  }
  if (event.target.id === 'sc-debug-close') debug.classList.remove('open');
  if (event.target.id === 'sc-dump') dumpCalibration();
  if (event.target.id === 'sc-skeleton') rig.skeletonHelper.visible = event.target.checked;
  if (event.target.id === 'sc-mic') rig.startMicrophone().then(() => { event.target.textContent = 'Microphone analyser enabled'; }).catch((error) => { say(error.message); });
  if (event.target.id === 'sc-save-greeting') localStorage.setItem('shinchan.greeting', debug.querySelector('#sc-greeting').value.trim());
});
debug.querySelector('#sc-greeting').value = localStorage.getItem('shinchan.greeting') || '';
debug.querySelector('#sc-arm-amplitude').value = String(rig.armAmplitude);
debug.querySelector('#sc-arm-value').textContent = rig.armAmplitude.toFixed(2);
debug.querySelector('#sc-arm-amplitude').addEventListener('input', (event) => { rig.armAmplitude = Number(event.target.value); rig.calibration.armAmplitude = rig.armAmplitude; rig.persistCalibration(); debug.querySelector('#sc-arm-value').textContent = rig.armAmplitude.toFixed(2); });
debug.querySelector('#sc-click-target').addEventListener('change', (event) => { debug.dataset.clickTarget = String(event.target.checked); });
for (const axis of ['x', 'y', 'z']) {
  const slider = debug.querySelector(`#sc-mouth-${axis}`);
  slider.value = String(rig.calibration.mouth?.[axis] ?? Number(slider.value));
  slider.addEventListener('input', (event) => {
    const value = Number(event.target.value); debug.querySelector(`#sc-mouth-${axis}-value`).textContent = value.toFixed(3);
    if (rig.mouth) rig.mouth.position[axis] = value;
    rig.calibration.mouth ||= { x: 0, y: -0.12, z: 0.24, width: 0.11, height: 0.045 };
    rig.calibration.mouth[axis] = value; rig.persistCalibration();
  });
}
for (const [id, key] of [['sc-mouth-width', 'width'], ['sc-mouth-height', 'height']]) {
  const slider = debug.querySelector(`#${id}`);
  slider.value = String(rig.calibration.mouth?.[key] ?? Number(slider.value));
  slider.addEventListener('input', () => {
    const value = Number(slider.value); rig.calibration.mouth ||= { x: 0, y: -0.12, z: 0.24, width: 0.11, height: 0.045 };
    rig.calibration.mouth[key] = value;
    if (rig.mouth) {
      const base = rig.mouth.userData.baseSize;
      rig.mouth.scale[key === 'width' ? 'x' : 'y'] = value / base[key];
    }
    rig.persistCalibration();
  });
}

function buildBoneSliders() {
  const host = debug.querySelector('#sc-bone-sliders'); host.replaceChildren();
  for (const key of Object.keys(rig.bones).sort()) {
    const section = document.createElement('div'); section.className = 'bone';
    const title = document.createElement('strong'); title.textContent = key; section.appendChild(title);
    for (const axis of ['x', 'y', 'z']) {
      const row = document.createElement('label'); row.textContent = axis.toUpperCase();
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '-1.5'; slider.max = '1.5'; slider.step = '0.01'; slider.value = String(rig.additiveOffsets[key]?.['xyz'.indexOf(axis)] || 0);
      const value = document.createElement('span'); value.textContent = Number(slider.value).toFixed(2);
      slider.addEventListener('input', () => {
        const index = 'xyz'.indexOf(axis); rig.additiveOffsets[key][index] = Number(slider.value); value.textContent = Number(slider.value).toFixed(2);
        rig.calibration.bones ||= {}; rig.calibration.bones[key] ||= { x: 0, y: 0, z: 0 }; rig.calibration.bones[key][axis] = Number(slider.value); rig.persistCalibration();
      });
      row.append(slider, value); section.appendChild(row);
    }
    host.appendChild(section);
  }
}
function dumpCalibration() {
  const blob = new Blob([JSON.stringify(rig.calibration, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'rig-calibration.json'; link.click(); URL.revokeObjectURL(link.href);
}

const pointer = { id: null, startX: 0, startY: 0, lastX: 0, lastY: 0, dragging: false, mascotHit: false };
let mascotTapTimes = [];
let voiceTapTimer = 0;
function isUiTarget(target) { return target instanceof Element && !!target.closest('#sc-debug,#sc-debug-toggle,#sc-action-menu,#sc-permission'); }
window.addEventListener('pointerdown', (event) => {
  if (isUiTarget(event.target)) return;
  const hit = rig.hitTest(event.clientX, event.clientY);
  if (hit?.type === 'permission') { event.preventDefault(); return; }
  if (hit?.type === 'mascot') {
    event.preventDefault(); pointer.id = event.pointerId; pointer.startX = pointer.lastX = event.clientX; pointer.startY = pointer.lastY = event.clientY; pointer.dragging = false; pointer.mascotHit = true;
    rig.wake(); renderer.domElement.setPointerCapture?.(event.pointerId); return;
  }
  pointer.mascotHit = false;
  if (pageMode === 'debug') {
    requestState('WALK_TO_TARGET', { x: event.clientX, y: event.clientY, force: true });
    return;
  }
  if (debug.classList.contains('open') && debug.dataset.clickTarget === 'true') {
    requestState('WALK_TO_TARGET', { x: event.clientX, y: event.clientY, force: true });
  }
  // Empty-screen input is intentionally inert in normal use.
}, { passive: false });
window.addEventListener('pointermove', (event) => {
  if (pointer.id !== event.pointerId || !pointer.mascotHit) return;
  if (pageMode === 'overlay' && window.AndroidBridge) return;
  const distance = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
  if (distance > 7) pointer.dragging = true;
  if (pointer.dragging) { rig.dragTo(event.clientX, event.clientY); pointer.lastX = event.clientX; pointer.lastY = event.clientY; }
});
window.addEventListener('pointerup', (event) => {
  if (pointer.id !== event.pointerId) return;
  if (pointer.dragging) { rig.home.copy(rig.model.position); say('Home moved. I will stay right here!'); }
  else if (pointer.mascotHit) {
    if (pageMode === 'overlay' && window.AndroidBridge) {
      pointer.id = null; pointer.mascotHit = false; pointer.dragging = false;
      return;
    }
    rig.tapReaction();
    if (pageMode === 'overlay') {
      const now = performance.now(); mascotTapTimes = mascotTapTimes.filter((time) => now - time < 700); mascotTapTimes.push(now);
      if (mascotTapTimes.length >= 3) { window.clearTimeout(voiceTapTimer); voiceTapTimer = 0; connectionDot.classList.toggle('visible'); mascotTapTimes = []; }
      else {
        window.clearTimeout(voiceTapTimer);
        voiceTapTimer = window.setTimeout(() => {
          if (window.AndroidBridge?.startVoiceInput) window.AndroidBridge.startVoiceInput();
          else say('Hehe! Tell me what you want to do!', { duration: 2200 });
          mascotTapTimes = [];
        }, 700);
      }
    } else {
      say('Hehe! You tapped me!');
      actionMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, event.clientX - 60))}px`;
      actionMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - 54, event.clientY - 62))}px`;
      actionMenu.classList.add('open'); window.setTimeout(() => actionMenu.classList.remove('open'), 5000);
    }
  }
  pointer.id = null; pointer.mascotHit = false; pointer.dragging = false;
});
window.addEventListener('pointercancel', () => { pointer.id = null; pointer.mascotHit = false; pointer.dragging = false; });
actionMenu.addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  actionMenu.classList.remove('open');
  if (action === 'talk') say('Hey! What shall we do together?', { speech: true });
  if (action === 'permission') rig.requestState('ASK_PERMISSION', { prompt: 'Would you like me to help with an action?', actionId: `menu-${Date.now()}` });
});

const bar = document.getElementById('sc-timeout');
const originalUpdate = rig.update.bind(rig);
rig.update = (dt) => {
  originalUpdate(dt);
  autonomy.update();
  if (bar && rig.state === 'ASK_PERMISSION') bar.style.transform = `scaleX(${Math.max(0, rig.permissionTimer / rig.permissionDuration)})`;
};

function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.resize(window.innerWidth, window.innerHeight);
  reportInteractiveBounds(true);
}
window.addEventListener('resize', resize);

let lastBoundsReport = 0;
function reportInteractiveBounds(force = false) {
  if (!rig.model || pageMode !== 'overlay') return;
  const now = performance.now(); if (!force && now - lastBoundsReport < 120) return; lastBoundsReport = now;
  rig.model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rig.model);
  if (box.isEmpty()) return;
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    corners.push(new THREE.Vector3(x, y, z).project(camera));
  }
  const xs = corners.map((point) => (point.x * 0.5 + 0.5) * window.innerWidth);
  const ys = corners.map((point) => (-point.y * 0.5 + 0.5) * window.innerHeight);
  const left = Math.max(0, Math.min(...xs) - 14); const top = Math.max(0, Math.min(...ys) - 14);
  const right = Math.min(window.innerWidth, Math.max(...xs) + 14); const bottom = Math.min(window.innerHeight, Math.max(...ys) + 14);
  connectionDot.style.left = `${Math.min(window.innerWidth - 10, Math.max(2, right + 2))}px`;
  connectionDot.style.top = `${Math.max(2, top)}px`;
  window.AndroidBridge?.setInteractiveBounds?.(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

const modelUrl = new URL(`${import.meta.env.BASE_URL}models/shinchan.glb`, window.location.href).href;
rig.loadModel(modelUrl).then((model) => {
  buildBoneSliders(); updateStatus(); loading.remove();
  rig.homeNdc = { x: 0.5, y: pageMode === 'overlay' ? 0.53 : 0.55 };
  rig.setWorldHomeFromNdc(); rig.model.position.copy(rig.home); reportInteractiveBounds(true);
  rig.requestState('idle_breathe', { force: true });
  console.info('[Shinchan] ready', rig.getDiagnostics());
  window.AndroidBridge?.pageReady?.();
}).catch((error) => {
  console.error('[Shinchan] model load failed', error);
  loading.remove(); window.AndroidBridge?.reportError?.(`Shinchan model failed to load: ${error.message || error}`);
  status.textContent = `Shinchan failed to load: ${error.message || error}`; status.style.background = '#991b1bdd';
  const warnings = document.getElementById('sc-warnings'); if (warnings) warnings.textContent = error.stack || String(error);
});

let lastTime = performance.now(); let fpsFrames = 0; let fpsTime = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if (document.hidden) { lastTime = now; return; }
  const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
  rig.update(dt); renderer.render(scene, camera);
  fpsFrames += 1; fpsTime += dt;
  if (fpsTime >= 0.5) { const fps = document.getElementById('sc-fps'); if (fps) fps.textContent = `FPS: ${Math.round(fpsFrames / fpsTime)}`; fpsFrames = 0; fpsTime = 0; updateStateReadout(); updateStatus(); }
  reportInteractiveBounds();
}
document.addEventListener('visibilitychange', () => { lastTime = performance.now(); });
requestAnimationFrame(animate);
