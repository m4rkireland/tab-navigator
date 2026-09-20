const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'tab-navigator.js'), 'utf8');
const listeners = new Map();
const window = {
  addEventListener(name, fn) { listeners.set(name, fn); },
  removeEventListener() {},
  dispatchEvent(event) { if (listeners.has(event.type)) listeners.get(event.type)(event); },
};
const location = { pathname: '/phone-room-test/overview', search: '' };
const history = {
  state: { preserved: true },
  replaceState(state, _title, path) { this.state = state; location.pathname = path; },
};
const document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  createElement(tag) {
    return {
      tagName: tag,
      style: {},
      append() {},
      addEventListener() {},
      setAttribute() {},
      textContent: '',
    };
  },
};
class BaseElement {
  constructor() { this._attached = false; }
  get isConnected() { return this._attached; }
  dispatchEvent() {}
  append() {}
}
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
let Card;
const customElements = { define: (_name, value) => { Card = value; }, get: () => undefined };
const session = new Map();
const sessionStorage = {
  getItem(key) { return session.get(key) || null; },
  setItem(key, value) { session.set(key, value); },
};
vm.runInNewContext(source, {
  HTMLElement: BaseElement,
  customElements,
  document,
  window,
  location,
  history,
  sessionStorage,
  setTimeout,
  clearTimeout,
  Date,
  CustomEvent,
});

const early = new Card();
assert.doesNotThrow(() => early.check(), 'early lifecycle checks must tolerate missing config');
early.setConfig({ enabled: true, require_device_opt_in: false, base_path: '/phone-room-test/' });
early.hass = {
  user: { id: 'mark', name: 'Mark' },
  connection: { connected: true },
  states: {},
};
assert.equal(Boolean(early._timer), false, 'detached elements must not schedule navigation');

const card = new Card();
card._attached = true;
card.setConfig({
  enabled: true, require_device_opt_in: false,
  base_path: '/phone-room-test/',
  user_entities: { mark: 'sensor.mark_area', cassie: 'sensor.cassie_area' },
  state_paths: { Kitchen: 'kitchen', Office: 'office' },
  default_tab: 'overview',
});
card.connectedCallback();
card.hass = {
  user: { id: 'mark', name: 'Mark' },
  connection: { connected: true },
  states: {
    'sensor.mark_area': { state: 'Kitchen' },
    'sensor.cassie_area': { state: 'Office' },
  },
};

new Promise(resolve => setTimeout(resolve, 350)).then(() => {
  assert.equal(location.pathname, '/phone-room-test/kitchen');
  assert.deepEqual(history.state, { preserved: true });

  location.pathname = '/phone-room-test/office';
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
  card.hass = {
    user: { id: 'mark', name: 'Mark' },
    connection: { connected: true },
    states: {
      'sensor.mark_area': { state: 'Office' },
      'sensor.cassie_area': { state: 'Office' },
    },
  };
  return new Promise(resolve => setTimeout(resolve, 350));
}).then(() => {
  assert.equal(location.pathname, '/phone-room-test/office', 'manual navigation must win during grace period');

  const remounted = new Card();
  remounted._attached = true;
  remounted.setConfig({
    enabled: true, require_device_opt_in: false,
    base_path: '/phone-room-test/',
    user_entities: { mark: 'sensor.mark_area', cassie: 'sensor.cassie_area' },
    state_paths: { Kitchen: 'kitchen', Office: 'office' },
    default_tab: 'overview',
  });
  remounted.connectedCallback();
  remounted.hass = {
    user: { id: 'mark', name: 'Mark' },
    connection: { connected: true },
    states: { 'sensor.mark_area': { state: 'Kitchen' } },
  };
  return new Promise(resolve => setTimeout(resolve, 350)).then(() => {
    assert.equal(location.pathname, '/phone-room-test/office', 'manual hold must survive card remount');
    remounted.disconnectedCallback();
  });
}).then(() => {
  console.log('PASS: scoped replaceState navigation, history preservation, and remount-safe manual grace');
  card.disconnectedCallback();
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
