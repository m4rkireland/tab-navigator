const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'tab-navigator.js');
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
let TabNavigator;
const registry = new Map();
const customElements = {
  define: (name, value) => { registry.set(name, value); TabNavigator = value; },
  get: name => registry.get(name),
};
const noopEvents = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
vm.runInNewContext(source, {
  HTMLElement: class {},
  customElements,
  document: { ...noopEvents, visibilityState: 'visible', querySelector: () => null },
  window: { ...noopEvents },
  location: { pathname: '/phone-room-test/overview', search: '' },
  history: { state: null },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval() {},
  Date,
  CustomEvent: class {},
});

assert.ok(TabNavigator, 'tab-navigator custom element must be registered');

const config = {
  base_path: '/phone-room-test/',
  user_entities: { mark: 'sensor.mark_area', cassie: 'sensor.cassie_area' },
  state_paths: { Kitchen: 'kitchen', Office: 'office' },
  default_tab: 'overview',
};
const hass = {
  user: { id: 'mark', name: 'Mark' },
  states: {
    'sensor.mark_area': { state: 'Kitchen' },
    'sensor.cassie_area': { state: 'Office' },
  },
};

assert.equal(TabNavigator.resolve(hass, config), 'kitchen');
hass.user.id = 'cassie';
assert.equal(TabNavigator.resolve(hass, config), 'office');
hass.user.id = 'unknown';
assert.equal(TabNavigator.resolve(hass, config), null, 'unknown users must be a no-op');
hass.user.id = 'mark';
hass.states['sensor.mark_area'].state = 'Unmapped';
assert.equal(TabNavigator.resolve(hass, config), 'overview');
delete hass.states['sensor.mark_area'];
assert.equal(TabNavigator.resolve(hass, config), 'overview');

const badConfig = {
  base_path: '/phone-room-test/',
  user_entities: { mark: 'sensor.mark_area' },
  state_paths: { Kitchen: '../other-dashboard' },
};
assert.equal(TabNavigator.resolve({ ...hass, states: { 'sensor.mark_area': { state: 'Kitchen' } } }, badConfig), null, 'unsafe paths must not resolve');

console.log('PASS: per-user entity isolation, state-to-path mapping, unknown-user no-op, fallback, unsafe-path rejection');
