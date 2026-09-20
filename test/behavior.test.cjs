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
      textContent: '',
    };
  },
};
class BaseElement { append() {} }
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
let Card;
const customElements = { define: (_name, value) => { Card = value; }, get: () => undefined };
vm.runInNewContext(source, {
  HTMLElement: BaseElement,
  customElements,
  document,
  window,
  location,
  history,
  sessionStorage: { getItem: () => '[]', setItem() {} },
  setTimeout,
  clearTimeout,
  Date,
  CustomEvent,
});

const card = new Card();
card.setConfig({
  enabled: true,
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
  console.log('PASS: scoped replaceState navigation, history preservation, and manual grace period');
  card.disconnectedCallback();
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
