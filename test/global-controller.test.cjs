const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tab-navigator.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatchEvent(event) {
    for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event);
    return true;
  }
}

function createBrowser({ enabled = false, user = 'mark', state = 'Kitchen', configOverride = {}, delayedRoot = false } = {}) {
  const window = new Events();
  const document = Object.assign(new Events(), {
    readyState: 'complete',
    visibilityState: 'visible',
    createElement: () => ({ style: {}, append() {}, addEventListener() {}, setAttribute() {} }),
  });
  class Element extends Events {
    constructor() { super(); this.style = {}; this.children = []; this.isConnected = false; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this[name] = value; }
  }
  class Event {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  }
  const control = {
    type: 'custom:tab-navigator-device',
    mode: 'control',
    enabled: true,
    require_device_opt_in: true,
    base_path: '/dashboard-legacy/',
    manual_grace_seconds: 30,
    user_entities: { mark: 'sensor.mark_area' },
    state_paths: { Kitchen: 'kitchen', Office: 'office' },
    ...configOverride,
  };
  const dashboard = { views: [{ sections: [{ cards: [control] }] }] };
  let connected = true;
  const root = {
    hass: {
      user: { id: user, name: user },
      connection: { get connected() { return connected; } },
      states: { 'sensor.mark_area': { state } },
      callWS: async message => {
        assert.equal(message.type, 'lovelace/config');
        assert.equal(message.url_path, 'dashboard-legacy');
        return dashboard;
      },
    },
  };
  let rootAvailable = !delayedRoot;
  document.querySelector = selector => selector === 'home-assistant' && rootAvailable ? root : null;
  const location = { pathname: '/dashboard-legacy/home', search: '' };
  const history = {
    state: { kept: true },
    replaceState(value, _title, target) { this.state = value; location.pathname = target; navigations += 1; },
  };
  const local = new Map();
  const session = new Map();
  if (enabled) local.set('tab-navigator-device-v1:mark:/dashboard-legacy/', 'true');
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) });
  const timeoutQueue = [];
  const intervals = [];
  let now = 100000;
  let navigations = 0;
  const registry = new Map();
  const customElements = {
    get: name => registry.get(name),
    define: (name, ctor) => registry.set(name, ctor),
    whenDefined: async () => {},
  };
  const sandbox = {
    HTMLElement: Element, window, document, location, history, customElements,
    localStorage: storage(local), sessionStorage: storage(session), CustomEvent: Event,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn) { timeoutQueue.push(fn); return timeoutQueue.length; },
    clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    queueMicrotask,
    console,
  };
  window.window = window;
  vm.runInNewContext(source, sandbox);

  async function flush() {
    for (let pass = 0; pass < 5; pass += 1) {
      await Promise.resolve();
      const pending = timeoutQueue.splice(0);
      pending.forEach(fn => fn());
    }
  }
  async function tick() {
    intervals.forEach(fn => fn());
    await flush();
  }
  return {
    window, document, root, location, history, local, session, control, flush, tick,
    navs: () => navigations,
    advance: ms => { now += ms; },
    setState(value) { root.hass.states['sensor.mark_area'] = { state: value }; },
    setConnected(value) { connected = value; },
    showRoot() { rootAvailable = true; },
    Event,
  };
}

(async () => {
  const enabled = createBrowser({ enabled: true });
  await enabled.flush();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/kitchen',
    'resource controller must navigate without any controller card mounted');
  assert.equal(enabled.history.state.kept, true, 'navigation preserves Home Assistant history state');

  const disabled = createBrowser();
  await disabled.flush();
  assert.equal(disabled.navs(), 0, 'a second browser with the same user stays disabled');

  const cassie = createBrowser({ enabled: true, user: 'cassie' });
  await cassie.flush();
  assert.equal(cassie.navs(), 0, 'an unmapped user cannot borrow Mark navigation');
  console.log('PASS: cardless global navigation and browser/user isolation');

  const startup = createBrowser({ enabled: true, delayedRoot: true });
  await startup.flush();
  startup.showRoot();
  await startup.tick();
  assert.equal(startup.location.pathname, '/dashboard-legacy/kitchen',
    'controller must discover dashboard config when HA root appears after the resource');
  console.log('PASS: delayed Home Assistant root startup');

  enabled.location.pathname = '/dashboard-legacy/settings';
  enabled.window.dispatchEvent(new enabled.Event('location-changed', { detail: { replace: false } }));
  enabled.setState('Office');
  await enabled.tick();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/settings', 'manual navigation wins during grace');
  enabled.advance(30001);
  enabled.window.dispatchEvent(new enabled.Event('pageshow'));
  await enabled.flush();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/office', 'pageshow rechecks after grace');

  enabled.location.pathname = '/dashboard-legacy/home';
  enabled.setConnected(false);
  enabled.setState('Kitchen');
  await enabled.tick();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/home', 'disconnected HA cannot navigate');
  enabled.setConnected(true);
  await enabled.tick();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/kitchen', 'reconnect rechecks cardless navigation');

  enabled.location.pathname = '/dashboard-legacy/home';
  enabled.setState('Away');
  await enabled.tick();
  assert.equal(enabled.location.pathname, '/dashboard-legacy/home', 'unknown/away states are a no-op');
  console.log('PASS: cardless grace, pageshow, reconnect, and unmapped-state guards');

  assert.ok(enabled.window.__tabNavigatorGlobalController,
    'resource installs one inspectable global singleton for hot-reload deduplication');
  const singleton = enabled.window.__tabNavigatorGlobalController;
  vm.runInNewContext(source, {
    ...enabled.window,
    HTMLElement: class {}, window: enabled.window, document: enabled.document,
  });
  assert.equal(enabled.window.__tabNavigatorGlobalController, singleton,
    'loading the resource twice must not duplicate the controller');
  console.log('PASS: global controller is singleton-safe');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
