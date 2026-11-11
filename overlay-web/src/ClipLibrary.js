const A = {
  Hips: [0, 0, 0], Spine: [0, 0, 0], Spine1: [0, 0, 0], Spine2: [0, 0, 0], Neck: [0, 0, 0], Head: [0, 0, 0], HeadTop_End: [0, 0, 0],
  LeftShoulder: [0, 0, 0], LeftArm: [0, 0, -1.15], LeftForeArm: [0.25, 0, 0], LeftHand: [0, 0, 0],
  LeftHandIndex1: [0, 0, 0], LeftHandIndex2: [0, 0, 0], LeftHandIndex3: [0, 0, 0], LeftHandIndex4: [0, 0, 0],
  RightShoulder: [0, 0, 0], RightArm: [0, 0, 1.15], RightForeArm: [0.25, 0, 0], RightHand: [0, 0, 0],
  RightHandIndex1: [0, 0, 0], RightHandIndex2: [0, 0, 0], RightHandIndex3: [0, 0, 0], RightHandIndex4: [0, 0, 0],
  LeftUpLeg: [0, 0, 0], LeftLeg: [0, 0, 0], LeftFoot: [0, 0, 0], LeftToeBase: [0, 0, 0], LeftToe_End: [0, 0, 0],
  RightUpLeg: [0, 0, 0], RightLeg: [0, 0, 0], RightFoot: [0, 0, 0], RightToeBase: [0, 0, 0], RightToe_End: [0, 0, 0]
};

const p = (values = {}) => Object.fromEntries(Object.entries(values).map(([bone, rotation]) => [bone, rotation.slice()]));
const mergePose = (...poses) => Object.assign({}, ...poses);
const root = (bounce = 0, squash = 0, sway = 0) => ({ bounce, squash, sway });
const frame = (at, pose, transform = root()) => ({ at, pose, root: transform });

function makeClip(name, duration, keys, loop = true) {
  return { name, duration, loop, keyframes: keys.map((key) => frame(key.at, mergePose(A, key.pose), key.root || root())) };
}

function loopClip(name, duration, first, second, firstRoot = root(), secondRoot = root()) {
  return makeClip(name, duration, [
    { at: 0, pose: first, root: firstRoot }, { at: 0.25, pose: second, root: secondRoot },
    { at: 0.5, pose: first, root: firstRoot }, { at: 0.75, pose: second, root: secondRoot }, { at: 1, pose: first, root: firstRoot }
  ]);
}

function actionClip(name, duration, pose, transform = root()) {
  return makeClip(name, duration, [
    { at: 0, pose: p() }, { at: 0.18, pose, root: transform }, { at: 0.72, pose, root: transform }, { at: 1, pose: p() }
  ], false);
}

const clips = {
  idle_breathe: loopClip('idle_breathe', 2.6, p({ Spine1: [0.015, 0, 0], Head: [0.005, 0, 0] }), p({ Spine1: [-0.005, 0, 0] })),
  idle_happy_bounce: loopClip('idle_happy_bounce', 1.05, p({ Head: [-0.05, 0, 0], LeftArm: [0.04, 0, -0.9], RightArm: [0.04, 0, 0.9] }), p({ Head: [0.12, 0, 0], LeftArm: [0, 0, -0.65], RightArm: [0, 0, 0.65] }), root(0, 0), root(0.12, -0.08)),
  look_around: loopClip('look_around', 3.8, p({ Head: [0, -0.28, 0.06] }), p({ Head: [0, 0.28, -0.06] })),
  stretch: actionClip('stretch', 2.3, p({ Spine: [-0.12, 0, 0], Spine1: [-0.1, 0, 0], LeftArm: [0.1, 0, 0.05], RightArm: [0.1, 0, -0.05], LeftForeArm: [0.1, 0, 0], RightForeArm: [0.1, 0, 0] }), root(0.04, -0.06)),
  yawn: actionClip('yawn', 2.6, p({ Head: [0.18, 0, 0], Spine: [0.08, 0, 0], LeftArm: [0.25, 0, -0.65], RightArm: [0.25, 0, 0.65] }), root(-0.03, -0.04)),
  scratch_head: actionClip('scratch_head', 2, p({ Head: [0, 0, -0.1], RightArm: [0.9, 0, 0.15], RightForeArm: [1.0, 0, 0.05], RightHand: [0.1, 0, 0] })),
  think: loopClip('think', 2.4, p({ Head: [0.03, 0, 0.22], RightArm: [0.55, 0, 0.22], RightForeArm: [1.05, 0, 0.1] }), p({ Head: [-0.02, 0, 0.27], RightForeArm: [1.15, 0, 0.1] })),
  listen: loopClip('listen', 2.2, p({ Spine: [0.1, 0, 0], Head: [0.02, 0.1, 0.1], RightArm: [0.58, 0, 0.3], RightForeArm: [0.8, 0, 0] }), p({ Head: [-0.04, -0.08, -0.08], RightForeArm: [0.72, 0, 0] })),
  talk_a: loopClip('talk_a', 0.72, p({ Head: [0.02, 0, 0], RightArm: [0.45, 0, 0.2], RightForeArm: [0.45, 0, 0.1] }), p({ Head: [-0.02, 0.04, 0.02], RightArm: [0.58, 0, 0.3], RightForeArm: [0.55, 0, 0.1] })),
  talk_b: loopClip('talk_b', 0.9, p({ Head: [0, -0.05, -0.04], LeftArm: [0.3, 0, -0.9] }), p({ Head: [0.05, 0.08, 0.04], LeftArm: [0.45, 0, -0.8], LeftForeArm: [0.2, 0, 0] })),
  talk_c: loopClip('talk_c', 0.8, p({ Head: [-0.02, 0.04, 0], RightArm: [0.7, 0, 0.1] }), p({ Head: [0.03, -0.04, 0.04], RightArm: [0.52, 0, 0.32] })),
  wave: actionClip('wave', 1.6, p({ RightArm: [0.35, 0, -0.4], RightForeArm: [0.8, 0, 0.05], RightHand: [0, 0, 0.35], Head: [0, 0, 0.08] }), root(0.06, -0.04)),
  cheer: actionClip('cheer', 1.5, p({ LeftArm: [0, 0, 0.1], RightArm: [0, 0, -0.1], LeftForeArm: [0.25, 0, 0], RightForeArm: [0.25, 0, 0], Head: [-0.08, 0, 0] }), root(0.18, -0.14)),
  clap: loopClip('clap', 0.75, p({ LeftArm: [0.5, 0, -0.55], RightArm: [0.5, 0, 0.55], LeftForeArm: [0.8, 0, 0], RightForeArm: [0.8, 0, 0] }), p({ LeftArm: [0.65, 0, -0.4], RightArm: [0.65, 0, 0.4], LeftForeArm: [1.15, 0, 0], RightForeArm: [1.15, 0, 0] })),
  jump: actionClip('jump', 0.95, p({ LeftUpLeg: [-0.35, 0, 0], RightUpLeg: [-0.35, 0, 0], LeftArm: [0, 0, 0.15], RightArm: [0, 0, -0.15] }), root(0.34, -0.18)),
  dance_silly: loopClip('dance_silly', 1.15, p({ Hips: [0, -0.36, 0.16], Spine1: [0.02, 0.18, -0.1], LeftArm: [0.18, 0, -0.55], RightArm: [0.3, 0, 0.75] }), p({ Hips: [0, 0.36, -0.16], Spine1: [0.02, -0.18, 0.1], LeftArm: [0.3, 0, -0.75], RightArm: [0.18, 0, 0.55] }), root(0.04, -0.04, -0.16), root(0.08, -0.06, 0.16)),
  dance_groove: loopClip('dance_groove', 1.8, p({ Hips: [0, -0.2, 0.1], Spine1: [0, 0.12, -0.08], LeftArm: [0.3, 0, -0.35], RightArm: [0.2, 0, 0.25] }), p({ Hips: [0, 0.2, -0.1], Spine1: [0, -0.12, 0.08], LeftArm: [0.2, 0, -0.25], RightArm: [0.3, 0, 0.35] }), root(0.05, -0.04, -0.08), root(0.05, -0.04, 0.08)),
  walk: loopClip('walk', 0.9, p({ LeftUpLeg: [0.38, 0, 0], RightUpLeg: [-0.38, 0, 0], LeftLeg: [0.12, 0, 0], RightLeg: [0, 0, 0], LeftArm: [0.08, 0, -0.95], RightArm: [0.08, 0, 0.95] }), p({ LeftUpLeg: [-0.38, 0, 0], RightUpLeg: [0.38, 0, 0], LeftLeg: [0, 0, 0], RightLeg: [0.12, 0, 0], LeftArm: [0.08, 0, -0.95], RightArm: [0.08, 0, 0.95] }), root(0.025, 0, -0.03), root(0.025, 0, 0.03)),
  run: loopClip('run', 0.55, p({ Spine: [0.15, 0, 0], LeftUpLeg: [0.65, 0, 0], RightUpLeg: [-0.5, 0, 0], LeftLeg: [0.2, 0, 0], RightLeg: [0.5, 0, 0], LeftArm: [-0.25, 0, -0.85], RightArm: [-0.25, 0, 0.85], LeftForeArm: [0.6, 0, 0], RightForeArm: [0.6, 0, 0] }), p({ Spine: [0.15, 0, 0], LeftUpLeg: [-0.5, 0, 0], RightUpLeg: [0.65, 0, 0], LeftLeg: [0.5, 0, 0], RightLeg: [0.2, 0, 0], LeftArm: [-0.25, 0, -0.85], RightArm: [-0.25, 0, 0.85], LeftForeArm: [0.6, 0, 0], RightForeArm: [0.6, 0, 0] }), root(0.06, -0.04), root(0.06, -0.04)),
  sit_watch: loopClip('sit_watch', 3, p({ Hips: [0.25, 0, 0], LeftUpLeg: [0.95, 0, 0], RightUpLeg: [0.95, 0, 0], LeftLeg: [-1.1, 0, 0], RightLeg: [-1.1, 0, 0], Head: [0, 0.12, 0] }), p({ Hips: [0.25, 0, 0], LeftUpLeg: [0.95, 0, 0], RightUpLeg: [0.95, 0, 0], LeftLeg: [-1.1, 0, 0], RightLeg: [-1.1, 0, 0], Head: [0, -0.12, 0] })),
  eat_snack: loopClip('eat_snack', 1.2, p({ RightArm: [0.6, 0, 0.15], RightForeArm: [1.0, 0, 0], Head: [0.08, 0, 0] }), p({ RightArm: [0.35, 0, 0.25], RightForeArm: [0.65, 0, 0], Head: [-0.02, 0, 0] })),
  sad_droop: loopClip('sad_droop', 2.8, p({ Head: [0.22, 0, -0.08], Spine: [0.18, 0, 0], LeftArm: [0.05, 0, -1.28], RightArm: [0.05, 0, 1.28] }), p({ Head: [0.28, 0, -0.1], Spine: [0.22, 0, 0] })),
  worried_fidget: loopClip('worried_fidget', 0.95, p({ Head: [0.03, 0.1, 0.08], LeftArm: [0.28, 0, -0.75], RightArm: [0.35, 0, 0.75], LeftForeArm: [0.35, 0, 0], RightForeArm: [0.45, 0, 0] }), p({ Head: [-0.02, -0.12, -0.08], LeftForeArm: [0.55, 0, 0], RightForeArm: [0.3, 0, 0] })),
  angry_stomp: loopClip('angry_stomp', 0.8, p({ Head: [-0.08, 0, 0], LeftArm: [0.1, 0, -1.3], RightArm: [0.1, 0, 1.3], LeftUpLeg: [0.25, 0, 0], RightUpLeg: [-0.25, 0, 0] }), p({ Head: [-0.08, 0, 0], LeftArm: [0.1, 0, -1.3], RightArm: [0.1, 0, 1.3], LeftUpLeg: [-0.4, 0, 0.1], RightUpLeg: [0.4, 0, -0.1] }), root(0, 0), root(-0.05, 0.04)),
  shy: loopClip('shy', 2.2, p({ Head: [0.08, -0.12, -0.18], LeftArm: [0.4, 0, -0.95], RightArm: [0.45, 0, 0.95], LeftForeArm: [0.5, 0, 0], RightForeArm: [0.55, 0, 0] }), p({ Head: [0.12, -0.16, -0.14], LeftArm: [0.35, 0, -1.0], RightArm: [0.4, 0, 1.0] })),
  laugh: loopClip('laugh', 0.65, p({ Head: [0.16, 0, 0], Spine: [-0.08, 0, 0], LeftArm: [0.4, 0, -0.7], RightArm: [0.45, 0, 0.7] }), p({ Head: [-0.04, 0, 0], Spine: [0.08, 0, 0], LeftForeArm: [0.65, 0, 0], RightForeArm: [0.65, 0, 0] }), root(0.04, -0.05), root(0.06, -0.06)),
  point_at_target: actionClip('point_at_target', 1.2, p({ RightArm: [0.25, 0, 0.35], RightForeArm: [0.1, 0, 0], RightHand: [0, 0, 0.1], Head: [0, 0.08, 0] })),
  poke: actionClip('poke', 0.8, p({ Spine: [0.12, 0, 0], RightArm: [-0.85, -0.12, 0.15], RightForeArm: [0.1, 0, 0], LeftArm: [0.05, 0, -1.05] }), root(0.02, -0.04)),
  hold_cards: loopClip('hold_cards', 1.8, p({ LeftArm: [0.4, 0, -0.48], RightArm: [0.4, 0, 0.48], LeftForeArm: [0.45, 0, 0], RightForeArm: [0.45, 0, 0] }), p({ LeftArm: [0.44, 0, -0.48], RightArm: [0.44, 0, 0.48], LeftForeArm: [0.5, 0, 0], RightForeArm: [0.5, 0, 0] })),
  proud_pose: loopClip('proud_pose', 1.6, p({ Hips: [0, -0.08, 0.04], Spine: [-0.08, 0, 0], Head: [-0.04, 0, 0], LeftArm: [0.05, 0, -0.75], RightArm: [0.05, 0, 0.75] }), p({ Hips: [0, 0.08, -0.04], Spine: [-0.08, 0, 0], LeftForeArm: [0.18, 0, 0], RightForeArm: [0.18, 0, 0] })),
  sleepy_nod: loopClip('sleepy_nod', 2.3, p({ Head: [0.12, 0, 0.1], Spine: [0.1, 0, 0] }), p({ Head: [0.48, 0, 0.04], Spine: [0.16, 0, 0] })),
  sleep_curled: loopClip('sleep_curled', 3.5, p({ Hips: [0.2, 0, 0], Spine: [0.32, 0, 0], Head: [0.55, 0, 0.18], LeftUpLeg: [0.45, 0, 0], RightUpLeg: [0.5, 0, 0], LeftLeg: [-0.55, 0, 0], RightLeg: [-0.6, 0, 0], LeftArm: [0.4, 0, -0.85], RightArm: [0.4, 0, 0.85] }), p({ Hips: [0.2, 0, 0], Spine: [0.32, 0, 0], Head: [0.58, 0, 0.16], LeftUpLeg: [0.45, 0, 0], RightUpLeg: [0.5, 0, 0] })),
  wake_jump: actionClip('wake_jump', 1, p({ Head: [-0.1, 0, 0], LeftArm: [0, 0, 0.1], RightArm: [0, 0, -0.1], LeftUpLeg: [-0.3, 0, 0], RightUpLeg: [-0.3, 0, 0] }), root(0.3, -0.16))
};

export const CLIP_NAMES = Object.freeze(Object.keys(clips));
export const BASE_A_POSE = A;
export function getClip(name) { return clips[String(name || '').toLowerCase()] || null; }

function interpolatePose(left, right, amount) {
  const result = {};
  for (const bone of Object.keys(A)) {
    const a = left.pose[bone] || A[bone]; const b = right.pose[bone] || A[bone];
    result[bone] = a.map((value, axis) => value + (b[axis] - value) * amount);
  }
  const transform = {};
  for (const key of ['bounce', 'squash', 'sway']) {
    const a = left.root[key] || 0; const b = right.root[key] || 0; transform[key] = a + (b - a) * amount;
  }
  return { pose: result, root: transform };
}

export function evaluateClip(clipOrName, elapsed) {
  const clip = typeof clipOrName === 'string' ? getClip(clipOrName) : clipOrName;
  if (!clip) return null;
  const duration = Math.max(0.001, clip.duration);
  const done = !clip.loop && elapsed >= duration;
  const phase = clip.loop ? ((elapsed % duration) + duration) % duration / duration : Math.min(1, Math.max(0, elapsed / duration));
  let rightIndex = clip.keyframes.findIndex((key) => key.at >= phase);
  if (rightIndex < 0) rightIndex = clip.keyframes.length - 1;
  const right = clip.keyframes[rightIndex]; const left = clip.keyframes[Math.max(0, rightIndex - 1)];
  const amount = right.at === left.at ? 0 : (phase - left.at) / (right.at - left.at);
  return { ...interpolatePose(left, right, amount), done, phase };
}
