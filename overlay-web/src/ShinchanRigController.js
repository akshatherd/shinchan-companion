import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import calibrationDefaults from '../rig-calibration.json';
import { BASE_A_POSE, evaluateClip, getClip, CLIP_NAMES } from './ClipLibrary.js';

const STATES = new Set([
  'BOOT_GREET', 'IDLE', 'LISTENING', 'THINKING', 'TALKING', 'WALK_TO_TARGET',
  'POKE', 'ASK_PERMISSION', 'PROUD', 'CONFUSED', 'SLEEPY', 'RETURN_HOME'
]);
const ALIASES = { WALK: 'WALK_TO_TARGET', WALK_AND_POKE: 'WALK_TO_TARGET', ASK: 'ASK_PERMISSION' };
const PRIORITY = { IDLE: 0, BOOT_GREET: 1, SLEEPY: 1, LISTENING: 2, THINKING: 2, TALKING: 2, PROUD: 2, CONFUSED: 2, WALK_TO_TARGET: 3, RETURN_HOME: 3, POKE: 4, ASK_PERMISSION: 5 };
const ALLOWED_TRANSITIONS = {
  BOOT_GREET: [...STATES], IDLE: [...STATES], LISTENING: [...STATES], THINKING: [...STATES], TALKING: [...STATES],
  WALK_TO_TARGET: ['POKE', 'ASK_PERMISSION', 'RETURN_HOME', 'IDLE'], POKE: ['RETURN_HOME', 'IDLE', 'ASK_PERMISSION'],
  ASK_PERMISSION: ['ASK_PERMISSION', 'RETURN_HOME', 'IDLE'], PROUD: [...STATES], CONFUSED: [...STATES], SLEEPY: [...STATES], RETURN_HOME: [...STATES]
};
export const REQUIRED_BONE_NAMES = Object.freeze([
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandIndex4',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandIndex4',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End'
]);
const WALK_STATES = new Set(['WALK_TO_TARGET', 'RETURN_HOME']);
const STATE_CLIPS = {
  BOOT_GREET: 'wave', IDLE: 'idle_breathe', LISTENING: 'listen', THINKING: 'think', TALKING: 'talk_a',
  WALK_TO_TARGET: 'run', POKE: 'poke', ASK_PERMISSION: 'hold_cards', PROUD: 'proud_pose', CONFUSED: 'worried_fidget',
  SLEEPY: 'sleepy_nod', RETURN_HOME: 'walk'
};

function canonicalBoneName(rawName = '') {
  return String(rawName).replace(/^mixamorig:?/i, '').replace(/_+\d+$/, '');
}

export class ShinchanRigController {
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.options = options;
    this.model = null;
    this.bones = Object.create(null);
    this.restQuats = Object.create(null);
    this.relaxedQuats = Object.create(null);
    this.restPositions = Object.create(null);
    this.baseOffsets = Object.create(null);
    this.baseVelocities = Object.create(null);
    this.additiveOffsets = Object.create(null);
    this.additiveVelocities = Object.create(null);
    this.clipTrackBones = new Set();
    this.clipTrackMap = new Map();
    this.state = 'BOOT_GREET';
    this.stateTimer = 0;
    this.stateParams = {};
    this.stateHistory = [];
    this.activeClipName = 'idle_breathe';
    this.clipElapsed = 0;
    this.currentPose = BASE_A_POSE;
    this.rootMotion = { bounce: 0, squash: 0, sway: 0 };
    this.armAmplitude = 1;
    this.animationWarning = '';
    this.lastClipLog = [];
    this.loadedMeshCount = 0;
    this.bootDuration = 2.4;
    this.idleElapsed = 0;
    this.nextIdleBehavior = this.randomBetween(8, 15);
    this.idleBehavior = null;
    this.inactiveSeconds = 0;
    this.sleepAfterSeconds = 300;
    this.worldScale = 100;
    this.screen = { width: window.innerWidth, height: window.innerHeight, halfW: 0, halfH: 0 };
    this.homeNdc = this.readSavedHome();
    this.home = new THREE.Vector3();
    this.moveTarget = new THREE.Vector3();
    this.pokePoint = new THREE.Vector3();
    this.pokePixels = { x: 0, y: 0 };
    this.walkSpeed = 1.9;
    this.pokeElapsed = 0;
    this.pokeContactSent = false;
    this.permission = null;
    this.permissionTimer = 0;
    this.permissionDuration = 12;
    this.pendingPermissionPosition = null;
    this.permissionCards = [];
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.groundShadow = this.makeGroundShadow();
    this.ripple = this.makeRipple();
    this.skeletonHelper = null;
    this.calibration = this.readCalibration();
    this.armAmplitude = Number.isFinite(this.calibration.armAmplitude) ? this.calibration.armAmplitude : 1;
    this.mouth = null;
    this.eyelids = [];
    this.blinkTimer = this.randomBetween(3, 6);
    this.blinkRemaining = 0;
    this.audioContext = null;
    this.audioAnalyser = null;
    this.audioData = null;
    this.audioStream = null;
    this.voiceAmplitude = 0;
    this.talkingEnvelope = 0;
    this.microphoneRequested = false;
    // The initial state is assigned directly because UI callbacks are not
    // installed until construction returns.
    this.stateHistory.push({ from: null, to: 'BOOT_GREET', at: performance.now() });
    this.resize(window.innerWidth, window.innerHeight);
  }

  randomBetween(min, max) { return min + Math.random() * (max - min); }
  readSavedHome() {
    try { const value = JSON.parse(localStorage.getItem('shinchan.home') || 'null'); if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) return value; } catch { /* keep default dock */ }
    return { x: 0.94, y: 0.91 };
  }
  readCalibration() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('shinchan.rigCalibration') || '{}'); } catch { /* bundled config remains usable */ }
    return { ...calibrationDefaults, ...saved, bones: { ...(calibrationDefaults.bones || {}), ...(saved.bones || {}) } };
  }
  persistCalibration() { localStorage.setItem('shinchan.rigCalibration', JSON.stringify(this.calibration, null, 2)); }
  saveHome() { localStorage.setItem('shinchan.home', JSON.stringify(this.homeNdc)); }
  safeMovementBounds() {
    const model = this.modelBounds || { halfW: 0.55, halfH: 0.9 };
    return {
      halfW: Math.max(0, this.screen.halfW - model.halfW * 1.2),
      halfH: Math.max(0, this.screen.halfH - model.halfH * 1.2)
    };
  }
  setWorldHomeFromNdc() {
    const safe = this.safeMovementBounds();
    this.home.set(
      (this.homeNdc.x - 0.5) * this.screen.width / this.worldScale,
      (0.5 - this.homeNdc.y) * this.screen.height / this.worldScale,
      0
    );
    this.home.x = THREE.MathUtils.clamp(this.home.x, -safe.halfW, safe.halfW);
    this.home.y = THREE.MathUtils.clamp(this.home.y, -safe.halfH, safe.halfH);
  }
  resize(width, height) {
    this.screen.width = Math.max(1, width); this.screen.height = Math.max(1, height);
    this.worldScale = Math.min(100, width / 2.15, height / 2.35);
    this.screen.halfW = width / (2 * this.worldScale); this.screen.halfH = height / (2 * this.worldScale);
    this.camera.fov = 38;
    this.camera.aspect = this.screen.width / this.screen.height;
    this.camera.near = 0.01; this.camera.far = 100;
    this.camera.position.set(0, 0, this.screen.halfH / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    this.setWorldHomeFromNdc();
    if (this.model && !WALK_STATES.has(this.state) && this.state !== 'POKE') this.model.position.copy(this.home);
  }

  async loadModel(url = `${import.meta.env.BASE_URL}models/shinchan.glb`) {
    const gltf = await new GLTFLoader().loadAsync(url);
    // Keep the GLTF's centering transform below a clean movement root. The
    // movement root is always the screen-space anchor (home/target); centering
    // the imported scene must not be overwritten when that anchor is assigned.
    this.model = new THREE.Group();
    this.model.name = 'ShinchanMovementRoot';
    this.assetRoot = gltf.scene;
    this.model.add(this.assetRoot);
    const originalBox = new THREE.Box3().setFromObject(this.assetRoot);
    const originalSize = originalBox.getSize(new THREE.Vector3());
    const scaleFactor = 1.8 / Math.max(0.001, originalSize.y);
    this.assetRoot.scale.setScalar(scaleFactor);
    this.modelBaseScale = this.assetRoot.scale.clone();
    const scaledBox = new THREE.Box3().setFromObject(this.assetRoot);
    const center = scaledBox.getCenter(new THREE.Vector3());
    this.assetRoot.position.set(-center.x, -center.y, -center.z);
    this.assetBasePosition = this.assetRoot.position.clone();
    this.modelBounds = { halfW: scaledBox.getSize(new THREE.Vector3()).x / 2, halfH: 0.9 };

    this.model.traverse((node) => {
      if (node.isSkinnedMesh || node.isMesh) {
        node.frustumCulled = false;
        node.visible = true;
        this.loadedMeshCount += 1;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          material.visible = true;
          material.side = THREE.DoubleSide;
          if ('roughness' in material) material.roughness = 0.6;
          if ('metalness' in material) material.metalness = 0;
          material.needsUpdate = true;
        }
      }
      if (node.isBone || node.type === 'Bone') {
        const key = canonicalBoneName(node.name);
        if (!key) return;
        this.bones[key] = node;
        this.restQuats[key] = node.quaternion.clone();
        this.restPositions[key] = node.position.clone();
        const entry = this.calibration.bones?.[key] || {};
        this.baseOffsets[key] = [...(BASE_A_POSE[key] || [0, 0, 0])];
        this.baseVelocities[key] = [0, 0, 0];
        this.additiveOffsets[key] = [entry.x || 0, entry.y || 0, entry.z || 0];
        this.additiveVelocities[key] = [0, 0, 0];
        console.info(`[ShinchanRig] rest ${key} (${node.name})`, node.quaternion.toArray());
      }
    });
    const missingBones = REQUIRED_BONE_NAMES.filter((name) => !this.bones[name]);
    console.info('[ShinchanRig] bound bones', Object.keys(this.bones));
    console.info('[ShinchanRig] per-frame bone writer: procedural keyframes plus layered breathing and expression');
    if (missingBones.length) console.warn('[ShinchanRig] expected bones not present in this model:', missingBones);

    // Put the character into an A-pose before adding it to the rendered scene.
    for (const [key, bone] of Object.entries(this.bones)) {
      const pose = BASE_A_POSE[key] || [0, 0, 0];
      this.relaxedQuats[key] = this.restQuats[key].clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose)));
      bone.quaternion.copy(this.relaxedQuats[key]);
    }
    this.setWorldHomeFromNdc();
    this.model.position.copy(this.home);
    this.scene.add(this.model);
    this.createGroundShadow();
    this.createFaceOverlays();
    this.createSkeletonHelper();
    this.createPermissionCards();
    this.logEmbeddedClips(gltf.animations || []);
    this.animationWarning = 'Embedded GLB animation clips are ignored; procedural cartoon clips drive the rig.';
    this.activeClipName = 'idle_breathe';
    this.clipElapsed = 0;
    this.transition('IDLE', { internal: true, clip: 'idle_breathe' });
    return this.model;
  }

  logEmbeddedClips(clips) {
    for (const clip of clips) console.info('[ShinchanRig] embedded clip', { name: clip.name, duration: clip.duration, tracks: clip.tracks.map((track) => track.name) });
    if (!clips.length) console.info('[ShinchanRig] no embedded animation clips');
  }
  greetingForTime() {
    const configured = localStorage.getItem('shinchan.greeting');
    if (configured) return configured;
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning! Ready for a fun day?' : hour < 18 ? 'Hey! Nice to see you again!' : 'Good evening! What are we doing today?';
  }
  playClipForState(state) {
    const clipName = STATE_CLIPS[state] || 'idle_breathe';
    if (!getClip(clipName)) return;
    this.activeClipName = clipName;
    this.clipElapsed = 0;
  }

  createGroundShadow() {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: 0x10121a, transparent: true, opacity: 0.2, depthWrite: false }));
    shadow.position.z = -0.88;
    shadow.scale.set(1.1, 0.35, 1);
    this.groundShadow.add(shadow);
    this.scene.add(this.groundShadow);
  }
  makeGroundShadow() { return new THREE.Group(); }
  makeRipple() {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 32), new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    mesh.visible = false; this.scene.add(mesh); return mesh;
  }
  createFaceOverlays() {
    const head = this.bones.Head;
    if (!head) return;
    this.headBaseScale = head.scale.clone();
    const mouthConfig = this.calibration.mouth || { x: 0, y: -0.12, z: 0.24, width: 0.11, height: 0.045 };
    const mouthTextures = ['closed', 'small', 'wide'].map((kind) => this.makeMouthTexture(kind));
    this.mouth = new THREE.Mesh(new THREE.PlaneGeometry(mouthConfig.width, mouthConfig.height), new THREE.MeshBasicMaterial({ map: mouthTextures[0], transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mouth.position.set(mouthConfig.x, mouthConfig.y, mouthConfig.z); this.mouth.userData.textures = mouthTextures; this.mouth.userData.baseSize = { width: mouthConfig.width, height: mouthConfig.height }; head.add(this.mouth);
    const eyeConfig = this.calibration.eyes || { x: 0.08, y: 0.05, z: 0.25, width: 0.055, height: 0.018 };
    for (const sign of [-1, 1]) {
      const eyelid = new THREE.Mesh(new THREE.PlaneGeometry(eyeConfig.width, eyeConfig.height), new THREE.MeshBasicMaterial({ color: 0x653c2f, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      eyelid.position.set(sign * eyeConfig.x, eyeConfig.y, eyeConfig.z); head.add(eyelid); this.eyelids.push(eyelid);
    }
  }
  makeMouthTexture(kind) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const c = canvas.getContext('2d'); c.fillStyle = '#45231f'; c.beginPath();
    if (kind === 'closed') { c.roundRect(30, 29, 68, 5, 3); }
    else if (kind === 'small') { c.ellipse(64, 32, 16, 11, 0, 0, Math.PI * 2); }
    else { c.ellipse(64, 33, 25, 17, 0, 0, Math.PI * 2); c.fillStyle = '#f8e7d3'; c.fillRect(46, 23, 36, 5); }
    c.fill(); const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  createSkeletonHelper() { this.skeletonHelper = new THREE.SkeletonHelper(this.model); this.skeletonHelper.visible = false; this.scene.add(this.skeletonHelper); }
  createPermissionCards() {
    this.permissionCards = [this.makePermissionCard(true), this.makePermissionCard(false)];
    for (const card of this.permissionCards) card.visible = false;
  }
  makePermissionCard(approved) {
    const green = approved; const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = green ? '#16a34a' : '#dc2626'; ctx.beginPath(); ctx.roundRect(10, 10, 300, 380, 34); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '150px sans-serif'; ctx.fillText(green ? '👍' : '👎', 160, 205); ctx.font = 'bold 48px system-ui'; ctx.fillText(green ? 'ALLOW' : 'DENY', 160, 310);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const group = new THREE.Group(); group.name = green ? 'ALLOW_CARD' : 'DENY_CARD'; group.userData.approved = green;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.84), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })); mesh.userData.card = group; group.add(mesh);
    const hand = this.bones[green ? 'LeftHand' : 'RightHand'];
    if (hand) hand.add(group); else this.model.add(group);
    return group;
  }

  toWorld(x, y) {
    const safe = this.safeMovementBounds();
    return new THREE.Vector3(
      THREE.MathUtils.clamp((x - this.screen.width / 2) / this.worldScale, -safe.halfW, safe.halfW),
      THREE.MathUtils.clamp((this.screen.height / 2 - y) / this.worldScale, -safe.halfH, safe.halfH),
      0
    );
  }
  toScreen(world) { return { x: world.x * this.worldScale + this.screen.width / 2, y: this.screen.height / 2 - world.y * this.worldScale }; }
  transition(state, params = {}) {
    const canonical = ALIASES[state] || state;
    if (!STATES.has(canonical)) return false;
    const from = this.state;
    if (!params.force && from && from !== canonical && !(ALLOWED_TRANSITIONS[from] || []).includes(canonical)) return false;
    this.state = canonical; this.stateTimer = 0; this.stateParams = params;
    this.stateHistory.push({ from, to: canonical, at: performance.now() });
    if (this.stateHistory.length > 40) this.stateHistory.shift();
    this.playClipForState(canonical);
    this.options.onState?.(canonical, params);
    return true;
  }
  requestState(name, params = {}) {
    if (getClip(name)) {
      this.activeClipName = String(name).toLowerCase(); this.clipElapsed = 0;
      this.inactiveSeconds = 0;
      return true;
    }
    const state = ALIASES[name] || name;
    if (!STATES.has(state)) { console.warn(`[ShinchanFSM] Ignored unknown state request: ${name}`); return false; }
    if (this.state === 'ASK_PERMISSION' && state !== 'ASK_PERMISSION' && !params.force && !['IDLE', 'RETURN_HOME'].includes(state)) return false;
    if (state !== 'IDLE' && PRIORITY[state] < PRIORITY[this.state] && !params.force) return false;
    this.inactiveSeconds = 0;
    if (state === 'WALK_TO_TARGET') {
      const x = Number.isFinite(params.x) ? params.x : this.screen.width * 0.5;
      const y = Number.isFinite(params.y) ? params.y : this.screen.height * 0.5;
      this.beginWalk(x, y, params); return true;
    }
    if (state === 'RETURN_HOME') { this.transition(state, params); this.moveTarget.copy(this.home); return true; }
    if (state === 'ASK_PERMISSION') { this.beginPermission(params); return true; }
    if (state === 'POKE') { this.pokeElapsed = 0; this.pokeContactSent = false; this.transition('POKE', params); return true; }
    if (state === 'IDLE' && this.model && this.model.position.distanceTo(this.home) > 0.08) {
      this.transition('RETURN_HOME', { ...params, internal: true }); this.moveTarget.copy(this.home); return true;
    }
    if (state === 'BOOT_GREET') params.greeting ||= this.greetingForTime();
    if (state === 'TALKING') this.talkingEnvelope = 0;
    this.transition(state, params);
    return true;
  }
  beginWalk(screenX, screenY, params = {}) {
    if (!this.model) return false;
    const target = this.toWorld(screenX, screenY);
    const delta = target.clone().sub(this.model.position); delta.z = 0;
    const distance = delta.length();
    if (distance > 0.001) target.addScaledVector(delta.normalize(), -Math.min(40 / this.worldScale, distance * 0.35));
    this.moveTarget.copy(target); this.pokePoint.copy(this.toWorld(screenX, screenY)); this.pokePixels = { x: screenX, y: screenY };
    this.stateParams = { ...params, screenX, screenY, permissionAfterWalk: false };
    this.transition('WALK_TO_TARGET', this.stateParams); return true;
  }
  beginPermission(params = {}) {
    const centerCandidate = this.toWorld(this.screen.width * 0.5, this.screen.height * 0.72);
    const homeDistanceToCenter = this.home.distanceTo(this.toWorld(this.screen.width * 0.5, this.screen.height * 0.5));
    const candidateDistanceToCenter = centerCandidate.distanceTo(this.toWorld(this.screen.width * 0.5, this.screen.height * 0.5));
    const position = homeDistanceToCenter < candidateDistanceToCenter ? this.home.clone() : centerCandidate;
    this.permission = { actionId: params.actionId || `action-${Date.now()}`, prompt: params.prompt || params.promptText || 'Should I do this?', params, answered: false };
    this.permissionTimer = this.permissionDuration;
    if (this.model && this.model.position.distanceTo(position) > 0.12) {
      this.moveTarget.copy(position); this.pendingPermissionPosition = position;
      this.transition('WALK_TO_TARGET', { permissionAfterWalk: true });
    } else this.showPermissionCards();
  }
  showPermissionCards() {
    if (!this.permission) return;
    this.pendingPermissionPosition = null;
    this.transition('ASK_PERMISSION', this.permission);
    const leftHand = this.bones.LeftHand; const rightHand = this.bones.RightHand;
    if (leftHand) this.permissionCards[0].position.set(-0.18, -0.05, 0.08);
    if (rightHand) this.permissionCards[1].position.set(0.18, -0.05, 0.08);
    this.permissionCards.forEach((c) => { c.visible = true; });
    this.options.onPermission?.(this.permission);
  }
  answerPermission(approved, reason = 'user') {
    if (!this.permission || this.permission.answered) return;
    this.permission.answered = true;
    const result = { type: 'PERMISSION_RESULT', actionId: this.permission.actionId, approved: !!approved, reason };
    this.options.onPermissionResult?.(result);
    if (window.AndroidBridge?.permissionResult) window.AndroidBridge.permissionResult(result.actionId, result.approved);
    if (!approved && window.AndroidBridge?.reportCorrection) window.AndroidBridge.reportCorrection(-1);
    this.hidePermissionCards(); this.permission = null;
    this.transition('RETURN_HOME', { force: true }); this.moveTarget.copy(this.home);
  }
  hidePermissionCards() { this.permissionCards.forEach((c) => { c.visible = false; }); }

  poseBone(name, rx = 0, ry = 0, rz = 0, slerp = 0.2) {
    const bone = this.bones[name];
    if (!bone || !this.restQuats[name]) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
    const target = this.restQuats[name].clone().multiply(q);
    bone.quaternion.slerp(target, THREE.MathUtils.clamp(slerp, 0, 1));
  }
  applyClipPose(dt, time) {
    const evaluated = evaluateClip(this.activeClipName, this.clipElapsed);
    if (!evaluated) return;
    this.currentPose = evaluated.pose;
    this.rootMotion = evaluated.root;
    for (const [key, bone] of Object.entries(this.bones)) {
      const value = evaluated.pose[key] || BASE_A_POSE[key] || [0, 0, 0];
      const rx = value[0] + (key === 'Spine1' ? Math.sin(time * 1.1) * 0.012 : 0);
      const ry = value[1];
      const rz = value[2];
      const [cx, cy, cz] = this.additiveOffsets[key] || [0, 0, 0];
      const follow = key === 'Head' && WALK_STATES.has(this.state) ? THREE.MathUtils.clamp((this.moveTarget.x - this.model.position.x) * 0.12, -0.25, 0.25) : 0;
      this.poseBone(key, rx + cx, ry + cy + follow, rz + cz, Math.min(1, dt * 14));
    }
    const bounce = evaluated.root.bounce || 0;
    const squash = evaluated.root.squash || 0;
    if (this.assetRoot && this.assetBasePosition) this.assetRoot.position.y = this.assetBasePosition.y + Math.sin(this.clipElapsed * Math.PI * 2 / Math.max(0.2, getClip(this.activeClipName)?.duration || 1)) * bounce * 0.35;
    if (this.assetRoot && this.modelBaseScale) {
      const y = Math.max(0.7, 1 + squash + Math.sin(time * 2) * 0.006);
      const xz = 1 / Math.sqrt(y);
      this.assetRoot.scale.set(this.modelBaseScale.x * xz, this.modelBaseScale.y * y, this.modelBaseScale.z * xz);
    }
  }
  updateMovement(dt) {
    if (!this.model) return;
    if (WALK_STATES.has(this.state)) {
      const delta = this.moveTarget.clone().sub(this.model.position); delta.z = 0;
      const distance = delta.length();
      if (distance <= 0.025) {
        this.model.position.copy(this.moveTarget);
        if (this.state === 'WALK_TO_TARGET') {
          if (this.stateParams.permissionAfterWalk) this.showPermissionCards();
          else { this.pokeElapsed = 0; this.pokeContactSent = false; this.transition('POKE', this.stateParams); }
        } else this.transition('IDLE', { internal: true });
      } else {
        const step = Math.min(distance, this.walkSpeed * dt);
        this.model.position.addScaledVector(delta.normalize(), step);
        const faceAngle = this.moveTarget.x < this.model.position.x ? -Math.PI / 2 : Math.PI / 2;
        this.model.rotation.y = THREE.MathUtils.damp(this.model.rotation.y, faceAngle, 6, dt);
      }
    }
    if (this.state === 'POKE') {
      this.pokeElapsed += dt;
      if (!this.pokeContactSent && this.pokeElapsed >= 0.32) {
        this.pokeContactSent = true;
        this.startRipple(this.pokePoint);
        if (window.AndroidBridge?.confirmTap) window.AndroidBridge.confirmTap(Math.round(this.pokePixels.x), Math.round(this.pokePixels.y));
        this.options.onPoke?.({ x: this.pokePixels.x, y: this.pokePixels.y });
      }
      if (this.pokeElapsed >= 0.78) { this.transition('RETURN_HOME', { internal: true }); this.moveTarget.copy(this.home); }
    }
    if (this.state === 'ASK_PERMISSION') {
      this.permissionTimer -= dt;
      this.model.rotation.y = THREE.MathUtils.damp(this.model.rotation.y, 0, 7, dt);
      if (this.permissionTimer <= 0) this.answerPermission(false, 'timeout');
    }
  }
  startRipple(point) { this.ripple.position.copy(point); this.ripple.position.z = 0.02; this.ripple.scale.setScalar(0.7); this.ripple.material.opacity = 0.9; this.ripple.visible = true; }
  updateRipple(dt) {
    if (!this.ripple.visible) return;
    this.ripple.scale.addScalar(dt * 2.2); this.ripple.material.opacity = Math.max(0, this.ripple.material.opacity - dt * 1.2);
    if (this.ripple.material.opacity <= 0) this.ripple.visible = false;
  }
  updateIdle(dt) {
    if (this.state !== 'IDLE') { this.idleElapsed = 0; return; }
    this.idleElapsed += dt; this.inactiveSeconds += dt;
    if (!this.idleBehavior && this.idleElapsed >= this.nextIdleBehavior) {
      const names = ['look_around', 'idle_happy_bounce', 'stretch', 'yawn'];
      this.idleBehavior = { name: names[Math.floor(Math.random() * names.length)], elapsed: 0, duration: this.randomBetween(1.2, 2.3) };
      this.activeClipName = this.idleBehavior.name; this.clipElapsed = 0;
      this.nextIdleBehavior = this.idleElapsed + this.randomBetween(8, 15);
    }
    if (this.idleBehavior) {
      this.idleBehavior.elapsed += dt;
      if (this.idleBehavior.elapsed >= this.idleBehavior.duration) { this.idleBehavior = null; this.activeClipName = 'idle_breathe'; this.clipElapsed = 0; }
    }
    if (this.inactiveSeconds >= this.sleepAfterSeconds) this.transition('SLEEPY', { internal: true });
  }
  updateFace(dt) {
    if (this.audioAnalyser) { this.audioAnalyser.getByteTimeDomainData(this.audioData); let energy = 0; for (const value of this.audioData) { const d = (value - 128) / 128; energy += d * d; } this.voiceAmplitude = THREE.MathUtils.clamp(Math.sqrt(energy / this.audioData.length) * 4, 0, 1); }
    else if (this.state === 'TALKING') { this.talkingEnvelope += dt * 10; this.voiceAmplitude = 0.15 + Math.abs(Math.sin(this.talkingEnvelope)) * 0.65; }
    else this.voiceAmplitude = THREE.MathUtils.damp(this.voiceAmplitude, 0, 8, dt);
    if (this.mouth) {
      const index = this.voiceAmplitude > 0.55 ? 2 : this.voiceAmplitude > 0.16 ? 1 : 0;
      const textures = this.mouth.userData.textures;
      if (this.mouth.material.map !== textures[index]) { this.mouth.material.map = textures[index]; this.mouth.material.needsUpdate = true; }
    }
    const head = this.bones.Head;
    if (head && this.headBaseScale) {
      const talkScale = this.voiceAmplitude * 0.018;
      head.scale.set(this.headBaseScale.x * (1 + talkScale), this.headBaseScale.y * (1 + talkScale * 0.65), this.headBaseScale.z * (1 + talkScale));
    }
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkRemaining <= 0) { this.blinkRemaining = 0.13; this.blinkTimer = this.randomBetween(3, 6); }
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;
    const opacity = this.blinkRemaining > 0 ? Math.min(1, this.blinkRemaining / 0.05) : 0;
    for (const eyelid of this.eyelids) eyelid.material.opacity = opacity;
  }
  update(dt) {
    if (!this.model) return;
    const delta = Math.min(Math.max(dt, 0), 0.05); this.stateTimer += delta;
    this.updateIdle(delta); this.updateMovement(delta);
    const time = performance.now() / 1000;
    this.clipElapsed += delta;
    if (this.state === 'TALKING' && this.clipElapsed > 0.72) this.activeClipName = ['talk_a', 'talk_b', 'talk_c'][Math.floor(this.clipElapsed / 0.72) % 3];
    const clip = getClip(this.activeClipName);
    if (clip && !clip.loop && this.clipElapsed >= clip.duration && this.state !== 'IDLE') {
      if (this.state === 'BOOT_GREET') { this.transition('IDLE', { internal: true }); this.activeClipName = 'idle_breathe'; }
      else if (this.state === 'POKE') this.activeClipName = 'poke';
      else { this.activeClipName = STATE_CLIPS[this.state] || 'idle_breathe'; this.clipElapsed = clip.duration; }
    }
    this.applyClipPose(delta, time);
    this.updateFace(delta); this.updateRipple(delta);
    this.groundShadow.position.x = this.model.position.x; this.groundShadow.position.y = this.model.position.y - 0.88;
    if (this.modelBaseScale) {
      let yScale = 1;
      if (this.state === 'BOOT_GREET') yScale = 0.84 + 0.16 * Math.min(1, this.stateTimer / 0.65);
      if (this.reactionTimer > 0) { this.reactionTimer = Math.max(0, this.reactionTimer - delta); yScale += Math.sin((1 - this.reactionTimer / 0.55) * Math.PI) * 0.15; }
      const xz = 1 / Math.sqrt(Math.max(0.5, yScale));
      // Scale only the imported asset. The movement root remains unit-scaled
      // so world-space targets and the stored dock position stay in pixels.
      this.assetRoot.scale.set(this.modelBaseScale.x * xz, this.modelBaseScale.y * yScale, this.modelBaseScale.z * xz);
    }
    if (this.state === 'BOOT_GREET' && this.stateTimer >= this.bootDuration) this.transition('IDLE', { internal: true });
    if (this.state === 'PROUD' && this.stateTimer >= (this.stateParams.duration || 2)) this.transition('RETURN_HOME', { internal: true });
    if (this.state === 'TALKING' && this.stateParams.duration && this.stateTimer >= this.stateParams.duration) this.transition('IDLE', { internal: true });
  }

  requestPermissionChoice(approved) { this.answerPermission(approved, 'user'); }
  hitTest(screenX, screenY) {
    this.pointerNdc.set(screenX / this.screen.width * 2 - 1, -(screenY / this.screen.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.state === 'ASK_PERMISSION') {
      const cards = this.raycaster.intersectObjects(this.permissionCards, true);
      if (cards.length) { const group = cards[0].object.userData.card || cards[0].object.parent; this.answerPermission(!!group.userData.approved); return { type: 'permission', approved: !!group.userData.approved }; }
    }
    const hit = this.model ? this.raycaster.intersectObject(this.model, true)[0] : null;
    return hit ? { type: 'mascot', hit } : null;
  }
  dragTo(screenX, screenY) {
    if (!this.model) return;
    this.model.position.copy(this.toWorld(screenX, screenY));
    this.home.copy(this.model.position);
    this.homeNdc = { x: screenX / this.screen.width, y: screenY / this.screen.height };
    this.saveHome();
  }
  wake() {
    this.inactiveSeconds = 0;
    if (this.state === 'SLEEPY') { this.transition('PROUD', { duration: 0.65, wakeHop: true }); }
  }
  tapReaction() {
    this.wake(); this.reactionTimer = 0.55;
    this.requestState('PROUD', { duration: 0.65, wakeHop: true, force: true });
  }
  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser.');
    if (this.audioAnalyser) return true;
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext(); this.audioAnalyser = this.audioContext.createAnalyser(); this.audioAnalyser.fftSize = 256;
    this.audioData = new Uint8Array(this.audioAnalyser.frequencyBinCount);
    this.audioContext.createMediaStreamSource(this.audioStream).connect(this.audioAnalyser);
    this.microphoneRequested = true; return true;
  }
  stopMicrophone() { this.audioStream?.getTracks().forEach((track) => track.stop()); this.audioContext?.close(); this.audioContext = null; this.audioAnalyser = null; this.audioStream = null; }
  getDiagnostics() {
    const box = this.model ? new THREE.Box3().setFromObject(this.model) : null;
      return { state: this.state, stateTimer: this.stateTimer, meshes: this.loadedMeshCount, bones: Object.keys(this.bones).length, boundBones: Object.keys(this.bones), activeClip: this.activeClipName, animationWarning: this.animationWarning, bounds: box ? box.getSize(new THREE.Vector3()).toArray() : null, trackLog: this.lastClipLog };
  }
}
