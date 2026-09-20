const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'tab-navigator.js'), 'utf8');
function browser(local = new Map()) {
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(k, f) { if (!this.listeners.has(k)) this.listeners.set(k, new Set()); this.listeners.get(k).add(f); }
    removeEventListener(k, f) { this.listeners.get(k)?.delete(f); }
    dispatchEvent(e) { for (const f of [...(this.listeners.get(e.type) || [])]) f(e); }
  }
  class Element extends Events {
    constructor() { super(); this.style = {}; this.children = []; this.isConnected = false; this.attrs = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(k, v) { this.attrs[k] = v; }
  }
  const window = new Events();
  const document = Object.assign(new Events(), { visibilityState: 'visible', createElement: () => new Element() });
  const location = { pathname: '/rooms/home', search: '' };
  let navigations = 0, now = 100000, timerId = 0;
  const timers = new Map(), session = new Map();
  const store = map => ({ getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) });
  const localStorage = store(local);
  let Card;
  class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  vm.runInNewContext(source, { HTMLElement: Element, window, document, location,
    history: { state: {}, replaceState(_s, _t, p) { location.pathname = p; navigations++; } },
    customElements: { get: () => undefined, define: (_k, c) => { Card = c; } },
    sessionStorage: store(session), localStorage, CustomEvent: Event,
    Date: class extends Date { static now() { return now; } },
    setTimeout(f) { timers.set(++timerId, f); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const config = { base_path: '/rooms/', user_entities: { mark: 'sensor.mark' }, state_paths: { Kitchen: 'kitchen', Office: 'office' } };
  const hass = (user = 'mark', state = 'Kitchen', connected = true) => ({ user: { id: user }, connection: { connected }, states: { 'sensor.mark': { state }, 'sensor.cassie': { state: 'Office' } } });
  const mount = (extra = {}, user = 'mark') => { const c = new Card(); c.setConfig({ ...config, ...extra }); c.hass = hass(user); c.isConnected = true; c.connectedCallback(); return c; };
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(f => f()); };
  return { mount, hass, flush, window, document, location, local, localStorage, session, timers, Event,
    advance: ms => { now += ms; }, navs: () => navigations, config };
}
const a = browser();
const controller = a.mount();
a.flush();
assert.equal(a.navs(), 0, 'navigation must be OFF by default even for a mapped user');
console.log('PASS: default-off per-browser navigation');
const ui = a.mount({ mode: 'control' });
assert.equal(ui._button.textContent, 'Enable on this device');
assert.match(ui._text.textContent, /Off/);
ui._button.dispatchEvent(new a.Event('click'));
assert.equal(ui._button.textContent, 'Disable on this device');
assert.equal(ui._button.attrs['aria-pressed'], 'true');
a.flush();
assert.equal(a.location.pathname, '/rooms/kitchen');
const b = browser(); b.mount(); b.flush();
assert.equal(b.navs(), 0, 'another browser with the same Mark login must remain OFF');
const cassie = a.mount({ mode: 'control' }, 'cassie');
assert.equal(cassie.hidden, true, 'unmapped user has no visible activation control');
const other = a.mount({ base_path: '/other/' });
assert.equal(other.isEnabled(), false, 'activation does not apply to another dashboard');
controller.hass = a.hass('mark', 'Office');
assert.ok(a.timers.size);
ui._button.dispatchEvent(new a.Event('click'));
assert.equal(a.timers.size, 0, 'disable cancels scheduled navigation immediately');
a.flush();
assert.equal(a.location.pathname, '/rooms/kitchen');
console.log('PASS: accessible control, browser/user/dashboard isolation, immediate opt-out');
const hiddenBrowser = browser();
const hidden = hiddenBrowser.mount({ mode: 'controller' });
assert.equal(hidden.hidden, true);
assert.equal(hidden.connectedWhileHidden, true, 'HA must keep hidden controllers connected');
assert.equal(hidden.children.length, 0, 'controller creates no UI');
assert.equal(hidden.getCardSize(), 0);
assert.equal(hidden.getGridOptions().rows, 0);
hidden.setDeviceEnabled(true); hiddenBrowser.flush();
assert.equal(hiddenBrowser.location.pathname, '/rooms/kitchen', 'hidden controller still operates');
console.log('PASS: connected-while-hidden HA contract and zero-size controller');
const duplicate = hiddenBrowser.mount({ mode: 'controller', state_paths: { Kitchen: 'wrong' } });
hidden.hass = hiddenBrowser.hass('mark', 'Office');
assert.equal(hiddenBrowser.timers.size, 1, 'only one controller may own navigation per user/dashboard');
hiddenBrowser.flush();
assert.equal(hiddenBrowser.location.pathname, '/rooms/office');
hidden.isConnected = false; hidden.disconnectedCallback();
hiddenBrowser.window.dispatchEvent(new hiddenBrowser.Event('pageshow'));
hiddenBrowser.flush();
assert.equal(hiddenBrowser.location.pathname, '/rooms/wrong', 'connected replacement takes ownership');
console.log('PASS: duplicate-controller ownership and detached handover');
const lifecycle = browser();
let life = lifecycle.mount({ mode: 'controller' });
life.setDeviceEnabled(true); lifecycle.flush();
lifecycle.location.pathname = '/rooms/home';
lifecycle.window.dispatchEvent(new lifecycle.Event('location-changed'));
life.isConnected = false; life.disconnectedCallback();
life = lifecycle.mount({ mode: 'controller' });
life.hass = lifecycle.hass('mark', 'Office'); lifecycle.flush();
assert.equal(lifecycle.location.pathname, '/rooms/home', 'Home stays usable for 30s after manual navigation and remount');
const anotherScope = lifecycle.mount({ mode: 'controller', base_path: '/other/' });
assert.equal(anotherScope.readManualHold(), 0, 'manual grace is dashboard scoped');
lifecycle.advance(30001);
lifecycle.window.dispatchEvent(new lifecycle.Event('pageshow')); lifecycle.flush();
assert.equal(lifecycle.location.pathname, '/rooms/office');
for (const state of ['unknown', 'unavailable', 'Away', 'not_home']) {
  life.hass = lifecycle.hass('mark', state); lifecycle.flush();
  assert.equal(lifecycle.location.pathname, '/rooms/office', 'unmapped states must not redirect');
}
lifecycle.localStorage.setItem(life.deviceKey(), 'false');
lifecycle.window.dispatchEvent(new lifecycle.Event('storage'));
for (const name of ['pageshow', 'location-changed', 'popstate', 'storage']) lifecycle.window.dispatchEvent(new lifecycle.Event(name));
lifecycle.document.dispatchEvent(new lifecycle.Event('visibilitychange'));
life.hass = lifecycle.hass('mark', 'Kitchen', false);
life.hass = lifecycle.hass('mark', 'Kitchen', true); lifecycle.flush();
assert.equal(lifecycle.location.pathname, '/rooms/office', 'disabled means no navigation on any lifecycle event');
console.log('PASS: scoped remount-safe grace, disabled lifecycle, unknown/away no-op');
// Storage failure is fail-closed, never a false claim of successful activation.
const blocked = browser();
const blockedUI = blocked.mount({ mode: 'control' });
blocked.localStorage.setItem = () => { throw new Error('blocked'); };
blockedUI._button.dispatchEvent(new blocked.Event('click'));
assert.equal(blockedUI.isEnabled(), false);
assert.match(blockedUI._text.textContent, /unavailable/);
const offline = browser(); const offlineUI = offline.mount({ mode: 'control' });
offlineUI.hass = offline.hass('mark', 'Kitchen', false);
offlineUI.setDeviceEnabled(true);
assert.match(offlineUI._text.textContent, /On/, 'control displays actual preference even while disconnected');
console.log('PASS: blocked storage fails closed and offline preference remains truthful');
// Same-origin tabs share a browser opt-in, not their independent manual grace.
const tab1 = browser(); const t1 = tab1.mount({ mode: 'controller' });
const tab2 = browser(tab1.local); const t2 = tab2.mount({ mode: 'controller' });
t1.setDeviceEnabled(true); tab1.flush();
tab2.window.dispatchEvent(new tab2.Event('storage')); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/kitchen');
t1.setDeviceEnabled(false);
t2.hass = tab2.hass('mark', 'Office'); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/kitchen', 'opt-out is re-read even before storage event delivery');
t2.setDeviceEnabled(true); tab2.flush();
tab2.location.pathname = '/rooms/home';
t2.hass = tab2.hass('mark', 'Kitchen', false); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/home');
t2.hass = tab2.hass('mark', 'Kitchen', true); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/kitchen', 'reconnect re-evaluates when opted in');
tab2.location.pathname = '/rooms/home';
tab2.document.visibilityState = 'hidden';
t2.hass = tab2.hass('mark', 'Office'); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/home');
tab2.document.visibilityState = 'visible';
tab2.document.dispatchEvent(new tab2.Event('visibilitychange')); tab2.flush();
assert.equal(tab2.location.pathname, '/rooms/office');
const previous = tab2.navs();
t2.hass = tab2.hass('cassie', 'Kitchen'); tab2.flush();
assert.equal(tab2.navs(), previous, 'switching users never borrows Mark opt-in');
t2.hass = tab2.hass('mark', 'Kitchen');
t2.isConnected = false; t2.disconnectedCallback(); tab2.flush();
assert.equal(tab2.navs(), previous, 'detach cancels pending navigation');
console.log('PASS: same-browser tab sync, enabled reconnect/foreground, user change and detach');
const failingDisable = browser();
const failingController = failingDisable.mount({ mode: 'controller' });
const failingControl = failingDisable.mount({ mode: 'control' });
failingControl.setDeviceEnabled(true);
failingDisable.localStorage.setItem = () => { throw new Error('quota'); };
failingControl.setDeviceEnabled(false); failingDisable.flush();
assert.equal(failingController.isEnabled(), false, 'failed persistence must still stop this page immediately');
assert.equal(failingDisable.navs(), 0);
console.log('PASS: opt-out stays safe even when persistence fails');
const registered = new Map();
vm.runInNewContext(source, { HTMLElement: class {}, customElements: { get: k => registered.get(k), define: (k, v) => registered.set(k, v) } });
assert.ok(registered.has('tab-navigator-device'), 'new production card name must not resolve to a cached v1.0.1 implementation');
console.log('PASS: cache-safe device card registration');
module.exports = { browser };
