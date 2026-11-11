import * as THREE from 'three';
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
        const clean = node.name.replace(/^mixamorig:?/i, '').replace(/_+\d+$/, '');
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
