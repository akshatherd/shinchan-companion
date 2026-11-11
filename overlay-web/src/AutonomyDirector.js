const idleClips = ['look_around', 'idle_happy_bounce', 'stretch', 'yawn'];

export class AutonomyDirector {
  constructor({ requestState, showBubble = () => {}, now = () => Date.now(), random = Math.random }) {
    this.requestState = requestState;
    this.showBubble = showBubble;
    this.now = now;
    this.random = random;
    this.lastActivityAt = this.now();
    this.nextIdleAt = this.lastActivityAt + this.interval();
    this.hiddenForPrivacy = false;
    this.lastEventAt = new Map();
    this.longIdleTriggered = false;
  }

  interval() { return (8 + this.random() * 7) * 1000; }

  handle(event = {}) {
    const bridge = globalThis.window?.AndroidBridge;
    const type = String(event.kind || event.type || event.name || '').toUpperCase();
    const time = this.now();
    const previous = this.lastEventAt.get(type) || 0;
    if (time - previous < 900) return;
    this.lastEventAt.set(type, time);
    this.lastActivityAt = time;
    this.nextIdleAt = time + this.interval();
    if (type !== 'IDLE_TIME') this.longIdleTriggered = false;

    if (type === 'PRIVACY_SUPPRESS') {
      this.hiddenForPrivacy = Boolean(event.hidden);
      bridge?.logDirector?.(`privacy suppression ${this.hiddenForPrivacy ? 'active' : 'cleared'}`);
      return;
    }
    if (this.hiddenForPrivacy) return;
    let clip = null;
    let reason = type;
    if (type === 'SCREEN_UNLOCK' || type === 'USER_PRESENT' || type === 'SCREEN_ON') clip = 'wake_jump';
    else if (type === 'SCREEN_OFF' || type === 'USER_IDLE' || type === 'IDLE_TIME' && Number(event.seconds || 0) >= 300) clip = 'sleep_curled';
    else if (type === 'CHARGING' || type === 'CHARGING_STATE') clip = event.charging === false ? 'idle_breathe' : 'proud_pose';
    else if (type === 'BATTERY_LOW' || type === 'LOW_BATTERY') clip = 'worried_fidget';
    else if (type === 'HEADSET') clip = event.connected === false ? 'look_around' : 'listen';
    else if (type === 'APP_FOREGROUND' || type === 'FOREGROUND_APP_CATEGORY') {
      const category = String(event.category || '').toLowerCase();
      if (event.private) { this.hiddenForPrivacy = true; bridge?.logDirector?.('private app: suppressing companion'); return; }
      if (category === 'video' || category === 'entertainment') clip = 'sit_watch';
      else if (category === 'work' || category === 'productivity') clip = 'listen';
      else clip = 'idle_happy_bounce';
      reason = `${type} category=${category || 'general'}`;
    } else if (type === 'IDLE_TIME' && Number(event.seconds || 0) >= 300 && !this.longIdleTriggered) {
      this.longIdleTriggered = true; this.requestState('sleep_curled', { force: true });
    }
    else if (type === 'TIME_TICK' || type === 'HOUR_OF_DAY') clip = (Number(event.hour) >= 22 || Number(event.hour) < 6) ? 'sleepy_nod' : 'look_around';
    else if (type === 'LONG_SCROLL_SESSION') clip = 'scratch_head';
    else if (type === 'TOUCH_TAP') clip = 'idle_happy_bounce';
    else if (type === 'DANCE_SILLY') clip = 'dance_silly';
    else if (type === 'LISTENING') clip = 'listen';
    else if (type === 'VOICE_TEST') clip = 'wave';
    if (clip) {
      this.requestState(clip, { force: true, event: type });
      bridge?.logDirector?.(`${reason} -> ${clip}`);
      if (event.speech) this.showBubble(event.speech);
    } else if (type !== 'IDLE_TIME') bridge?.logDirector?.(`${type}: no animation rule`);
  }

  update() {
    if (this.hiddenForPrivacy || this.now() < this.nextIdleAt) return;
    this.nextIdleAt = this.now() + this.interval();
    const name = idleClips[Math.floor(this.random() * idleClips.length)];
    this.requestState(name, { force: true, autonomous: true });
  }
}
