import pathlib

ROOT = pathlib.Path(__file__).parent.resolve()

RIG_JS = """import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ShinchanRigController {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.model = null;
    this.bones = {};
    this.restQuats = {};
    this.state = 'IDLE';
    this.clock = new THREE.Clock();
    this.stateTime = 0;

    this.targetPos = new THREE.Vector3(0, -0.85, 0);
    this.pokeWorldPos = new THREE.Vector3();
    this.pokeScreenCoords = { x: 0, y: 0 };
    this.walkPhase = 'NONE';
    this.pokeTimer = 0;
    this.pokeFired = false;
    this.onPokeCallback = null;

    this.voiceLevel = 0;
    this.nextAutoTimer = 4.5;
    this.pendingActionId = null;

    this.approveCard = null;
    this.rejectCard = null;
    this.shockwave = null;
    this.createShockwave();
  }

  async loadModel(url = './models/shinchan.glb') {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    this.model = gltf.scene;

    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scaleFactor = 1.65 / (size.y || 1);
    this.model.scale.setScalar(scaleFactor);

    box.setFromObject(this.model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    this.model.position.set(-center.x, -box.min.y - 0.85, -center.z);

    this.model.traverse((node) => {
      if (node.isMesh && node.material) {
        node.material.roughness = 0.6;
        node.material.metalness = 0.05;
        node.material.needsUpdate = true;
      }
      if (node.isBone || node.type === 'Bone' || node.name.toLowerCase().includes('mixamorig')) {
        const clean = node.name.replace(/^mixamorig:?/i, '').replace(/_+\\d+$/, '');
        this.bones[clean] = node;
        this.restQuats[clean] = node.quaternion.clone();
      }
    });

    this.scene.add(this.model);
    this.createPermissionCards();
    this.setState('IDLE');
    return this.model;
  }

  createPermissionCards() {
    const makeTex = (bg, icon, text) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 320;
      const ctx = c.getContext('2d');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(10, 10, 236, 300, 36); ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '105px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(icon, 128, 160);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif';
      ctx.fillText(text, 128, 255);
      return new THREE.CanvasTexture(c);
    };
    const geo = new THREE.PlaneGeometry(0.52, 0.66);
    this.approveCard = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: makeTex('#16a34a', '👍', 'ALLOW'), transparent: true, side: THREE.DoubleSide }));
    this.approveCard.name = 'CARD_APPROVE';
    this.approveCard.visible = false;

    this.rejectCard = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: makeTex('#dc2626', '👎', 'DENY'), transparent: true, side: THREE.DoubleSide }));
    this.rejectCard.name = 'CARD_REJECT';
    this.rejectCard.visible = false;

    this.scene.add(this.approveCard);
    this.scene.add(this.rejectCard);
  }

  createShockwave() {
    const geo = new THREE.RingGeometry(0.05, 0.14, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    this.shockwave = new THREE.Mesh(geo, mat);
    this.scene.add(this.shockwave);
  }

  poseBone(name, rx = 0, ry = 0, rz = 0, slerp = 0.2) {
    const b = this.bones[name];
    if (!b || !this.restQuats[name]) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
    const target = this.restQuats[name].clone().multiply(q);
    b.quaternion.slerp(target, slerp);
  }

  applyRelaxedAPose(slerp = 0.18) {
    this.poseBone('LeftArm', 0.08, 0, -1.15, slerp);
    this.poseBone('RightArm', 0.08, 0, 1.15, slerp);
    this.poseBone('LeftForeArm', 0.25, 0, -0.12, slerp);
    this.poseBone('RightForeArm', 0.25, 0, 0.12, slerp);
  }

  setState(newState, actionId = null) {
    this.state = newState;
    this.stateTime = 0;
    if (actionId) this.pendingActionId = actionId;
    const showCards = newState === 'ASK_PERMISSION';
    if (this.approveCard && this.rejectCard) {
      this.approveCard.visible = showCards;
      this.rejectCard.visible = showCards;
    }
    if (window.AndroidBridge && window.AndroidBridge.setInteractive) {
      window.AndroidBridge.setInteractive(showCards || newState === 'LISTENING');
    }
  }

  screenToWorld(screenX, screenY) {
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera);
    const dir = vec.sub(this.camera.position).normalize();
    const dist = -this.camera.position.z / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(dist));
  }

  walkAndPoke(screenX, screenY, onPoke = null) {
    this.pokeScreenCoords = { x: screenX, y: screenY };
    this.onPokeCallback = onPoke;
    const worldPt = this.screenToWorld(screenX, screenY);
    this.pokeWorldPos.copy(worldPt);
    this.targetPos.set(
      THREE.MathUtils.clamp(worldPt.x - 0.2, -1.8, 1.8),
      THREE.MathUtils.clamp(worldPt.y - 0.75, -1.4, 0.7),
      0
    );
    this.walkPhase = 'WALK_TO_POKE';
    this.pokeFired = false;
    this.setState('WALK_AND_POKE');
  }

  roamToRandomEdge() {
    if (this.state !== 'IDLE') return;
    const marginX = window.innerWidth * (Math.random() > 0.5 ? 0.22 : 0.78);
    const marginY = window.innerHeight * (0.35 + Math.random() * 0.45);
    const worldPt = this.screenToWorld(marginX, marginY);
    this.targetPos.set(
      THREE.MathUtils.clamp(worldPt.x, -1.4, 1.4),
      THREE.MathUtils.clamp(worldPt.y - 0.5, -1.2, 0.4),
      0
    );
    this.walkPhase = 'ROAM';
    this.setState('WALK_AND_POKE');
  }

  update(dt) {
    if (!this.model) return;
    this.stateTime += dt;
    const t = this.clock.getElapsedTime();

    if (this.state === 'IDLE') {
      this.nextAutoTimer -= dt;
      if (this.nextAutoTimer <= 0) {
        this.nextAutoTimer = 6 + Math.random() * 6;
        const pick = Math.random();
        if (pick < 0.45) this.roamToRandomEdge();
        else if (pick < 0.70) {
          this.setState('PROUD');
          setTimeout(() => { if (this.state === 'PROUD') this.setState('IDLE'); }, 2600);
        } else if (pick < 0.88) {
          this.setState('THINKING');
          setTimeout(() => { if (this.state === 'THINKING') this.setState('IDLE'); }, 2400);
        } else {
          this.setState('CONFUSED');
          setTimeout(() => { if (this.state === 'CONFUSED') this.setState('IDLE'); }, 2200);
        }
      }
    }

    ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].forEach((b) => {
      this.poseBone(b, 0, 0, 0, 0.14);
    });

    const breath = Math.sin(t * 2.8) * 0.045;

    if (this.state === 'IDLE') {
      this.applyRelaxedAPose(0.15);
      this.poseBone('Spine1', breath, 0, 0);
      this.poseBone('Head', Math.sin(t * 1.3) * 0.09, Math.sin(t * 0.8) * 0.32, Math.cos(t * 1.1) * 0.07);
      this.poseBone('Hips', 0, Math.sin(t * 1.5) * 0.07, Math.sin(t * 3.0) * 0.03);
      this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, 0, 0.12);
    }
    else if (this.state === 'LISTENING') {
      this.poseBone('Spine', 0.22, 0, 0);
      this.poseBone('Head', -0.14, 0.2, -0.15);
      this.poseBone('LeftArm', 0.1, 0, -1.1);
      this.poseBone('RightArm', 0.85, 0.3, 0.35);
      this.poseBone('RightForeArm', 1.4, 0, 0.4);
    }
    else if (this.state === 'THINKING') {
      this.poseBone('Head', 0.1, 0.12, 0.32);
      this.poseBone('LeftArm', 0.2, 0, -1.0);
      this.poseBone('RightArm', 0.65, -0.2, 0.55);
      this.poseBone('RightForeArm', 1.55 + Math.sin(t * 8) * 0.12, 0, 0.3);
    }
    else if (this.state === 'PROUD') {
      const w = Math.sin(t * 13);
      this.poseBone('Hips', 0.25, w * 0.48, w * 0.2);
      this.poseBone('Spine1', -0.15, -w * 0.25, 0);
      this.poseBone('Head', Math.sin(t * 6.5) * 0.15, w * 0.22, w * 0.15);
      this.poseBone('LeftArm', 0, 0, 0.65 + w * 0.25);
      this.poseBone('RightArm', 0, 0, -0.65 + w * 0.25);
      this.poseBone('LeftForeArm', 0.6, 0, -0.4);
      this.poseBone('RightForeArm', 0.6, 0, 0.4);
      this.poseBone('LeftUpLeg', Math.max(0, w) * 0.45, 0, 0);
      this.poseBone('RightUpLeg', Math.max(0, -w) * 0.45, 0, 0);
    }
    else if (this.state === 'CONFUSED') {
      this.poseBone('Head', 0.08, Math.sin(t * 3) * 0.25, -0.35);
      this.poseBone('LeftArm', 0.1, 0, -1.05);
      this.poseBone('RightArm', 1.25, 0.2, 0.15);
      this.poseBone('RightForeArm', 1.45 + Math.sin(t * 11) * 0.2, 0, 0.2);
    }
    else if (this.state === 'SLEEPY') {
      this.applyRelaxedAPose(0.1);
      this.poseBone('Spine', 0.28, 0, 0);
      this.poseBone('Head', Math.sin(t * 1.5) * 0.18 + 0.35, 0, 0.1);
    }
    else if (this.state === 'ASK_PERMISSION') {
      this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, 0, 0.15);
      this.poseBone('LeftArm', 0.55, 0.2, -0.45);
      this.poseBone('RightArm', 0.55, -0.2, 0.45);
      this.poseBone('LeftForeArm', 0.75, 0, 0);
      this.poseBone('RightForeArm', 0.75, 0, 0);
      if (this.approveCard && this.rejectCard) {
        this.approveCard.position.set(this.model.position.x - 0.62, this.model.position.y + 1.0 + Math.sin(t * 4) * 0.04, 0.5);
        this.rejectCard.position.set(this.model.position.x + 0.62, this.model.position.y + 1.0 + Math.cos(t * 4) * 0.04, 0.5);
      }
    }
    else if (this.state === 'WALK_AND_POKE') {
      if (this.walkPhase === 'WALK_TO_POKE' || this.walkPhase === 'ROAM') {
        const dx = this.targetPos.x - this.model.position.x;
        const dy = this.targetPos.y - this.model.position.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.06) {
          const speed = (this.walkPhase === 'ROAM' ? 1.4 : 2.8) * dt;
          this.model.position.x += (dx / dist) * Math.min(speed, dist);
          this.model.position.y += (dy / dist) * Math.min(speed, dist);
          this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, dx >= 0 ? 0.38 : -0.38, 0.2);

          const stride = Math.sin(t * (this.walkPhase === 'ROAM' ? 10 : 16));
          this.poseBone('LeftUpLeg', stride * 0.7, 0, 0, 0.35);
          this.poseBone('RightUpLeg', -stride * 0.7, 0, 0, 0.35);
          this.poseBone('LeftLeg', Math.max(0, -stride) * 0.55, 0, 0, 0.35);
          this.poseBone('RightLeg', Math.max(0, stride) * 0.55, 0, 0, 0.35);
          this.poseBone('LeftArm', -stride * 0.5, 0, -0.95, 0.35);
          this.poseBone('RightArm', stride * 0.5, 0, 0.95, 0.35);
          this.poseBone('Spine', 0.18, 0, stride * 0.07, 0.35);
        } else {
          if (this.walkPhase === 'ROAM') {
            this.walkPhase = 'NONE';
            this.setState('IDLE');
          } else {
            this.walkPhase = 'POKING';
            this.pokeTimer = 0;
          }
        }
      } else if (this.walkPhase === 'POKING') {
        this.pokeTimer += dt;
        this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, 0, 0.25);
        this.poseBone('LeftArm', 0.1, 0, -1.1);
        const jab = Math.sin(Math.min(1, this.pokeTimer * 4.2) * Math.PI);
        this.poseBone('RightArm', -1.25 - jab * 0.38, -0.25, 0.2, 0.45);
        this.poseBone('RightForeArm', -0.2, 0, 0, 0.45);

        if (this.pokeTimer >= 0.22 && !this.pokeFired) {
          this.pokeFired = true;
          this.triggerShockwave(this.pokeWorldPos);
          if (this.onPokeCallback) this.onPokeCallback(this.pokeScreenCoords.x, this.pokeScreenCoords.y);
          if (window.AndroidBridge && window.AndroidBridge.confirmTap) {
            window.AndroidBridge.confirmTap(Math.round(this.pokeScreenCoords.x), Math.round(this.pokeScreenCoords.y));
          }
        }
        if (this.pokeTimer >= 0.65) {
          this.walkPhase = 'NONE';
          this.setState('PROUD');
          setTimeout(() => { if (this.state === 'PROUD') this.setState('IDLE'); }, 1800);
        }
      }
    }

    if (this.voiceLevel > 0.02 && this.bones['Head']) {
      this.bones['Head'].rotation.x += Math.sin(t * 28) * this.voiceLevel * 0.16;
      this.poseBone('LeftArm', 0.3 + Math.sin(t * 10) * 0.2, 0, -0.85, 0.25);
      this.poseBone('RightArm', 0.3 + Math.cos(t * 10) * 0.2, 0, 0.85, 0.25);
    }

    if (this.shockwave && this.shockwave.material.opacity > 0.01) {
      this.shockwave.scale.addScalar(dt * 4.5);
      this.shockwave.material.opacity = Math.max(0, this.shockwave.material.opacity - dt * 2.2);
    }
  }

  triggerShockwave(worldPos) {
    if (!this.shockwave || !worldPos) return;
    this.shockwave.position.copy(worldPos);
    this.shockwave.scale.set(1, 1, 1);
    this.shockwave.material.opacity = 0.95;
  }
}
"""

MAIN_JS = """import * as THREE from 'three';
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
"""

BRAIN_PY = """import json, math, sqlite3, time
from collections import Counter
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Shinchan-MUSE RAG & Behavioral ML Brain")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH = "shinchan_memory.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("CREATE TABLE IF NOT EXISTS rag_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, tags TEXT, ts REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS ui_traces (id INTEGER PRIMARY KEY AUTOINCREMENT, pkg TEXT, action TEXT, label TEXT, x INT, y INT, ts REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS bandit_weights (action_key TEXT PRIMARY KEY, successes INT, trials INT)")
    conn.commit()
    conn.close()

init_db()

def tokenize(text: str):
    return [w.lower() for w in text.replace(",", " ").replace(".", " ").split() if len(w) > 1]

def save_rag_memory(text: str, tags: str = "chat"):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT INTO rag_memories (text, tags, ts) VALUES (?, ?, ?)", (text, tags, time.time()))
    conn.commit()
    conn.close()

def retrieve_rag_context(query: str, top_k: int = 3):
    q_tokens = Counter(tokenize(query))
    if not q_tokens:
        return []
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT text, ts FROM rag_memories ORDER BY id DESC LIMIT 200").fetchall()
    conn.close()
    scored = []
    for text, ts in rows:
        d_tokens = Counter(tokenize(text))
        dot = sum(q_tokens[k] * d_tokens[k] for k in q_tokens if k in d_tokens)
        norm = (math.sqrt(sum(v*v for v in q_tokens.values())) * math.sqrt(sum(v*v for v in d_tokens.values()))) or 1.0
        sim = dot / norm
        if sim > 0.05:
            scored.append((sim, text))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in scored[:top_k]]

def mine_frequent_habit():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT pkg, label, x, y, COUNT(*) as cnt FROM ui_traces GROUP BY pkg, label ORDER BY cnt DESC LIMIT 1").fetchall()
    conn.close()
    if rows and rows[0][4] >= 3:
        return {"pkg": rows[0][0], "label": rows[0][1], "x": rows[0][2], "y": rows[0][3], "count": rows[0][4]}
    return None

@app.get("/health")
def health():
    return {"status": "alive", "engine": "RAG + HabitMiner + LinUCB"}

@app.websocket("/ws/companion")
async def companion_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            mtype = data.get("type", "")

            if mtype == "VOICE_COMMAND":
                user_text = data.get("text", "")
                memories = retrieve_rag_context(user_text)
                save_rag_memory(f"User said: {user_text}", "voice")
                lower = user_text.lower()

                if any(k in lower for k in ["click", "tap", "open", "send", "whatsapp"]):
                    habit = mine_frequent_habit()
                    tx, ty = (habit["x"], habit["y"]) if habit else (540, 1200)
                    await ws.send_text(json.dumps({
                        "type": "PROPOSE_SKILL",
                        "reply": f"Yo! Want me to run your '{user_text}' workflow and tap ({tx}, {ty})? Tap 👍 ALLOW!",
                        "emotion": "ASK_PERMISSION",
                        "ask_permission": True,
                        "target_coords": {"x": tx, "y": ty}
                    }))
                elif "dance" in lower or "buri" in lower:
                    await ws.send_text(json.dumps({
                        "reply": "Buri Buri!! Watch my legendary wiggle dance!",
                        "emotion": "PROUD"
                    }))
                else:
                    mem_hint = f" (I also remember: {memories[0]})" if memories else ""
                    await ws.send_text(json.dumps({
                        "reply": f"Haan bro! Got it: '{user_text}'.{mem_hint}",
                        "emotion": "PROUD"
                    }))

            elif mtype == "UI_TRACE":
                conn = sqlite3.connect(DB_PATH)
                conn.execute(
                    "INSERT INTO ui_traces (pkg, action, label, x, y, ts) VALUES (?, ?, ?, ?, ?, ?)",
                    (data.get("pkg", ""), data.get("action", "TAP"), data.get("label", ""), int(data.get("x", 540)), int(data.get("y", 960)), time.time())
                )
                conn.commit()
                conn.close()
                habit = mine_frequent_habit()
                if habit and habit["count"] % 5 == 0:
                    await ws.send_text(json.dumps({
                        "type": "PROPOSE_SKILL",
                        "reply": f"I learned your habit on {habit['label']}! Want me to automate it now?",
                        "emotion": "ASK_PERMISSION",
                        "ask_permission": True,
                        "target_coords": {"x": habit["x"], "y": habit["y"]}
                    }))
    except WebSocketDisconnect:
        pass
"""

(ROOT / "overlay-web" / "src" / "ShinchanRigController.js").write_text(RIG_JS, encoding="utf-8")
(ROOT / "overlay-web" / "src" / "main.js").write_text(MAIN_JS, encoding="utf-8")
(ROOT / "brain-server" / "main.py").write_text(BRAIN_PY, encoding="utf-8")
print("SUCCESS: Upgraded overlay-web & brain-server!")