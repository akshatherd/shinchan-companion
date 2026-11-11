import * as THREE from 'three';
import { ShinchanRigController } from './ShinchanRigController.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.05, 4.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.style.background = 'transparent';
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const dirLight = new THREE.DirectionalLight(0xfff7e6, 1.7);
dirLight.position.set(2.5, 4, 5);
scene.add(dirLight);

const shinchan = new ShinchanRigController(scene, camera);
window.shinchan = shinchan;
shinchan.loadModel('./models/shinchan.glb');

const bubble = document.createElement('div');
bubble.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);max-width:86vw;background:rgba(15,23,42,0.92);color:#fff;padding:8px 16px;border-radius:18px;font-family:system-ui,sans-serif;font-size:13px;font-weight:600;border:2px solid #facc15;box-shadow:0 6px 20px rgba(0,0,0,0.3);pointer-events:none;text-align:center;z-index:9999;opacity:0;transition:opacity 0.25s;';
document.body.appendChild(bubble);

let bubbleTimeout = null;
function say(text, speakTts = true) {
  bubble.textContent = text;
  bubble.style.opacity = '1';
  clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => { bubble.style.opacity = '0'; }, 5500);

  shinchan.voiceLevel = 0.85;
  setTimeout(() => { shinchan.voiceLevel = 0.0; }, Math.min(4500, Math.max(1500, text.length * 65)));

  if (speakTts) {
    if (window.AndroidBridge && window.AndroidBridge.speak) {
      window.AndroidBridge.speak(text);
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 1.45; u.rate = 1.08;
      window.speechSynthesis.speak(u);
    }
  }
}
window.shinchanSay = say;

let ws = null;
let serverUrl = localStorage.getItem('BRAIN_WS_URL') || 'ws://127.0.0.1:8000/ws/companion';

function connectBrain(url) {
  if (url) {
    serverUrl = url;
    localStorage.setItem('BRAIN_WS_URL', url);
  }
  try {
    ws = new WebSocket(serverUrl);
    ws.onopen = () => say('Buri Buri! Brain connected! Say "Shinchan" anytime!', false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleBrainCommand(msg);
      } catch (e) {}
    };
    ws.onclose = () => setTimeout(() => connectBrain(), 6000);
  } catch (e) {}
}
connectBrain();

function handleBrainCommand(msg) {
  if (msg.reply) say(msg.reply, true);
  if (msg.emotion) shinchan.setState(msg.emotion);
  if (msg.type === 'PROPOSE_SKILL' || msg.ask_permission) {
    shinchan.PendingTap = msg.target_coords || { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    shinchan.setState('ASK_PERMISSION', msg.action_id || 'auto_1');
  } else if (msg.type === 'EXECUTE_TAP' && msg.x !== undefined && msg.y !== undefined) {
    shinchan.walkAndPoke(msg.x, msg.y);
  }
}

window.onVoiceTranscript = (rawText) => {
  const text = (rawText || '').trim();
  if (!text) return;
  const lower = text.toLowerCase();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'VOICE_COMMAND', text }));
    return;
  }

  if (lower.includes('dance') || lower.includes('buri') || lower.includes('naach')) {
    say('Hehehe! Check out my signature Buri Buri wiggle dance!');
    shinchan.setState('PROUD');
  } else if (lower.includes('whatsapp') || lower.includes('message') || lower.includes('send')) {
    say('Drafted your message! Tap 👍 ALLOW in my hand and I will press Send for you!');
    shinchan.PendingTap = { x: window.innerWidth * 0.88, y: window.innerHeight * 0.90 };
    shinchan.setState('ASK_PERMISSION', 'whatsapp_send');
  } else if (lower.includes('scroll') || lower.includes('click') || lower.includes('tap') || lower.includes('poke')) {
    const tx = window.innerWidth * 0.5;
    const ty = window.innerHeight * 0.45;
    say('Running to tap the screen for you right now!');
    shinchan.walkAndPoke(tx, ty);
  } else if (lower.includes('sleep') || lower.includes('so ja')) {
    say('Oyasumi bro... wake me up when we ship code.');
    shinchan.setState('SLEEPY');
  } else {
    say('Haan bro! Main sun raha hu: "' + text + '". Bol, kahan tap karu?');
    shinchan.setState('PROUD');
  }
};

window.onSystemEvent = (eventType, payloadJson) => {
  if (eventType === 'WAKE_WORD') {
    shinchan.setState('LISTENING');
    say('👂 Haan bro? Bol kya karna hai!', true);
  } else if (eventType === 'UNLOCK') {
    shinchan.setState('PROUD');
    say('Yo welcome back! Ready to hustle?');
  }
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (shinchan.state === 'ASK_PERMISSION') {
    const hits = raycaster.intersectObjects([shinchan.approveCard, shinchan.rejectCard]);
    if (hits.length > 0) {
      if (hits[0].object.name === 'CARD_APPROVE') {
        say('👍 Approved! Running to tap the button!');
        const pt = shinchan.PendingTap || { x: window.innerWidth * 0.7, y: window.innerHeight * 0.5 };
        shinchan.walkAndPoke(pt.x, pt.y);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PERMISSION_FEEDBACK', approved: true, reward: 1.0 }));
        }
      } else {
        say('👎 Cancelled! Got it, I will not do that.');
        shinchan.setState('CONFUSED');
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PERMISSION_FEEDBACK', approved: false, reward: -1.0 }));
        }
      }
      return;
    }
  }

  if (shinchan.model) {
    const modelHits = raycaster.intersectObject(shinchan.model, true);
    if (modelHits.length > 0) {
      shinchan.setState('LISTENING');
      say('👂 Listening... Speak your command!');
      if (window.AndroidBridge && window.AndroidBridge.startListeningNow) {
        window.AndroidBridge.startListeningNow();
      }
      return;
    }
  }

  shinchan.walkAndPoke(e.clientX, e.clientY);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  shinchan.update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
