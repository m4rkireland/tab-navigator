/*
 * Tab Navigator — browser-local Home Assistant dashboard navigation.
 *
 * The resource owns one zero-DOM controller. Dashboard configuration is read
 * from the single visible control card; no hidden controller cards are needed.
 * It only replaces the current URL and never calls services or writes entities.
 */
(function registerTabNavigator() {
  const VERSION = '1.0.4';
  const ELEMENT = 'tab-navigator';
  const DEVICE_ELEMENT = 'tab-navigator-device';
  const GLOBAL_KEY = '__tabNavigatorGlobalController';

  // A cache-busted resource can be evaluated more than once in one page.
  if (typeof window !== 'undefined' && window[GLOBAL_KEY]?.version === VERSION) return;

  const storageFailures = new Set();

  function mapFor(config, primary, legacy) {
    const value = config && (config[primary] ?? config[legacy]);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function safePath(value) {
    if (typeof value !== 'string') return null;
    const path = value.trim().replace(/^\/+|\/+$/g, '');
    if (!path || path.includes('..') || path.includes('?') || path.includes('#')) return null;
    return path;
  }

  function basePath(value) {
    const path = typeof value === 'string' && value.trim() ? value.trim() : '/';
    const withSlash = path.startsWith('/') ? path : `/${path}`;
    return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
  }

  function dashboardSlug(pathname) {
    const segment = String(pathname || '').split('/').filter(Boolean)[0];
    return segment || null;
  }

  function validateConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const users = mapFor(raw, 'user_entities', 'users');
    const paths = mapFor(raw, 'state_paths', 'tabs');
    const userEntities = {};
    const statePaths = {};
    for (const [user, entity] of Object.entries(users)) {
      if (typeof user === 'string' && user && typeof entity === 'string' && entity.includes('.')) {
        userEntities[user] = entity;
      }
    }
    for (const [state, path] of Object.entries(paths)) {
      const safe = safePath(path);
      if (typeof state === 'string' && state && safe) statePaths[state] = safe;
    }
    const base = basePath(raw.base_path);
    if (base === '/' || Object.keys(userEntities).length === 0) return null;
    const fallback = raw.default_tab == null ? null : safePath(raw.default_tab);
    if (raw.default_tab != null && !fallback) return null;
    const seconds = Number(raw.manual_grace_seconds);
    return {
      enabled: raw.enabled !== false,
      require_device_opt_in: raw.require_device_opt_in !== false,
      base_path: base,
      manual_grace_seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : 30,
      user_entities: userEntities,
      state_paths: statePaths,
      default_tab: fallback,
    };
  }

  function findControlConfig(value) {
    const matches = [];
    const visit = node => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const type = node.type;
      if ((type === `custom:${ELEMENT}` || type === `custom:${DEVICE_ELEMENT}`) && node.mode === 'control') {
        const config = validateConfig(node);
        if (config) matches.push(config);
      }
      Object.values(node).forEach(visit);
    };
    visit(value);
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveTarget(hass, config) {
    if (!hass || !config) return null;
    const userId = hass.user && hass.user.id;
    const entityId = userId && config.user_entities[userId];
    if (!entityId) return null;
    const state = hass.states && hass.states[entityId] && hass.states[entityId].state;
    return safePath(config.state_paths[state]) || config.default_tab || null;
  }

  class GlobalController {
    constructor() {
      this.version = VERSION;
      this.config = null;
      this.hass = null;
      this._dashboard = null;
      this._configLoadedFor = null;
      this._configRequest = 0;
      this._pendingReason = 'resource loaded';
      this._manualHoldUntil = 0;
      this._stateKey = null;
      this._connected = false;
      this._timer = null;
      this._onVisibility = () => {
        if (document.visibilityState === 'visible') this.requestCheck('foreground');
        else this.cancelPending();
      };
      this._onPageShow = () => this.requestCheck('pageshow');
      this._onLocationChanged = event => {
        if (event && event.detail && event.detail.tabNavigator === true) return;
        if (this.config && this.isInScope()) {
          this._manualHoldUntil = Date.now() + this.graceMs();
          this.writeManualHold(this._manualHoldUntil);
        }
        this.requestCheck('manual navigation');
        this.tick();
      };
      this._onStorage = () => this.requestCheck('device preference changed');
    }

    start() {
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('pageshow', this._onPageShow);
      window.addEventListener('location-changed', this._onLocationChanged);
      window.addEventListener('popstate', this._onLocationChanged);
      window.addEventListener('storage', this._onStorage);
      window.addEventListener('tab-navigator-device-changed', this._onStorage);
      this._interval = setInterval(() => this.tick(), 1000);
      this.tick();
    }

    rootHass() {
      const root = document.querySelector && document.querySelector('home-assistant');
      return root && root.hass;
    }

    async loadDashboardConfig(slug, hass) {
      if (!slug || !hass || typeof hass.callWS !== 'function') return;
      this._configLoadedFor = slug;
      const request = ++this._configRequest;
      try {
        const raw = await hass.callWS({ type: 'lovelace/config', url_path: slug });
        if (request !== this._configRequest || dashboardSlug(location.pathname) !== slug) return;
        const config = findControlConfig(raw && raw.config ? raw.config : raw);
        this.config = config;
        this._manualHoldUntil = this.readManualHold();
        this.requestCheck(config ? 'dashboard configuration loaded' : 'no unique control configuration');
      } catch (_) {
        if (request === this._configRequest) {
          this.config = null;
          this.cancelPending();
        }
      }
    }

    acceptConfig(raw, hass) {
      const config = validateConfig(raw);
      if (!config || !hass || !location.pathname.startsWith(config.base_path)) return;
      this.hass = hass;
      this.config = config;
      this._dashboard = dashboardSlug(config.base_path);
      this._configLoadedFor = this._dashboard;
      this._manualHoldUntil = this.readManualHold();
      this.requestCheck('control configuration loaded');
    }

    tick() {
      const hass = this.rootHass() || this.hass;
      const slug = dashboardSlug(location.pathname);
      if (slug !== this._dashboard) {
        this._dashboard = slug;
        this._configLoadedFor = null;
        this.config = null;
        this.cancelPending();
        this.loadDashboardConfig(slug, hass);
      }
      if (!this.config && hass && this._configLoadedFor !== slug) this.loadDashboardConfig(slug, hass);
      if (!hass) return;
      const wasConnected = this._connected;
      this.hass = hass;
      this._connected = Boolean(hass.connection && hass.connection.connected === true);
      const userId = hass.user && hass.user.id || '';
      const entityId = this.config && this.config.user_entities[userId] || '';
      const state = entityId && hass.states && hass.states[entityId] ? hass.states[entityId].state : '';
      const key = `${userId}|${entityId}|${state}`;
      if (!wasConnected && this._connected) this._pendingReason = 'HA reconnected';
      else if (this._stateKey !== null && key !== this._stateKey) this._pendingReason = 'state update';
      this._stateKey = key;
      this.check();
    }

    requestCheck(reason) {
      this.cancelPending();
      this._pendingReason = reason;
      this.check();
    }

    graceMs() { return (this.config?.manual_grace_seconds ?? 30) * 1000; }

    deviceKey() {
      return `tab-navigator-device-v1:${this.hass?.user?.id || 'unknown'}:${basePath(this.config?.base_path)}`;
    }

    holdKey() { return `tab-navigator-hold-v2:${this.deviceKey()}`; }

    readManualHold() {
      try {
        const value = Number(sessionStorage.getItem(this.holdKey()));
        return Number.isFinite(value) && value > Date.now() ? value : 0;
      } catch (_) { return 0; }
    }

    writeManualHold(value) {
      try { sessionStorage.setItem(this.holdKey(), String(value || 0)); }
      catch (_) { /* optional storage */ }
    }

    deviceEnabled() {
      if (storageFailures.has(this.deviceKey())) return false;
      try { return localStorage.getItem(this.deviceKey()) === 'true'; }
      catch (_) { return false; }
    }

    setDeviceEnabled(enabled, raw, hass) {
      if (raw) this.acceptConfig(raw, hass || this.hass);
      if (!this.config || !this.config.user_entities[this.hass?.user?.id]) return false;
      const key = this.deviceKey();
      try {
        localStorage.setItem(key, String(enabled === true));
        storageFailures.delete(key);
      } catch (_) {
        storageFailures.add(key);
      }
      window.dispatchEvent(new CustomEvent('tab-navigator-device-changed'));
      this.requestCheck('device preference changed');
      return !storageFailures.has(key);
    }

    isEnabled() {
      return Boolean(this.config?.enabled && this.config.user_entities[this.hass?.user?.id]) &&
        (this.config.require_device_opt_in === false || this.deviceEnabled());
    }

    isInScope() { return Boolean(this.config && location.pathname.startsWith(this.config.base_path)); }

    isGuarded() {
      return Boolean(location.search && location.search.includes('edit')) ||
        Boolean(history.state && history.state.dialog);
    }

    targetPath() {
      const path = resolveTarget(this.hass, this.config);
      return path ? `${this.config.base_path}${path}` : null;
    }

    cancelPending() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }

    check() {
      if (!this.config || !this.isEnabled() || !this._connected ||
          document.visibilityState !== 'visible' || !this.isInScope() || this.isGuarded()) {
        this.cancelPending();
        return;
      }
      if (!this._pendingReason || this._timer || Date.now() < this._manualHoldUntil) return;
      const reason = this._pendingReason;
      this._pendingReason = null;
      this._timer = setTimeout(() => {
        this._timer = null;
        this.tick();
        if (!this.config || !this.isEnabled() || !this._connected ||
            document.visibilityState !== 'visible' || !this.isInScope() || this.isGuarded() ||
            Date.now() < this._manualHoldUntil) return;
        const target = this.targetPath();
        if (!target || location.pathname === target) return;
        history.replaceState(history.state, '', target);
        window.dispatchEvent(new CustomEvent('location-changed', {
          detail: { replace: true, tabNavigator: true, reason },
        }));
      }, 300);
    }
  }

  const globalController = new GlobalController();
  window[GLOBAL_KEY] = globalController;
  globalController.start();

  class TabNavigator extends HTMLElement {
    get connectedWhileHidden() { return true; }

    static resolve(hass, config) {
      return resolveTarget(hass, validateConfig(config));
    }

    setConfig(config) {
      this.config = config && typeof config === 'object' ? config : {};
      if (this._hass && this.config.mode === 'control') globalController.acceptConfig(this.config, this._hass);
      this.render();
    }

    connectedCallback() {
      if (this._hass && this.config?.mode === 'control') globalController.acceptConfig(this.config, this._hass);
      this.render();
    }

    disconnectedCallback() { /* Global controller owns lifecycle. */ }

    set hass(value) {
      this._hass = value;
      if (this.config?.mode === 'control') globalController.acceptConfig(this.config, value);
      this.render();
    }

    get hass() { return this._hass; }

    setDeviceEnabled(enabled) {
      return globalController.setDeviceEnabled(enabled, this.config, this._hass);
    }

    deviceEnabled() {
      globalController.acceptConfig(this.config, this._hass);
      return globalController.deviceEnabled();
    }

    isEnabled() {
      globalController.acceptConfig(this.config, this._hass);
      return globalController.isEnabled();
    }

    render() {
      if (!this._hass || !this._hass.user || !this.config || typeof document === 'undefined') return;
      const users = mapFor(this.config, 'user_entities', 'users');
      const visible = this.config.mode !== 'controller' && Boolean(users[this._hass.user.id]);
      if (this.hidden !== !visible) {
        this.hidden = !visible;
        this.dispatchEvent(new CustomEvent('card-visibility-changed', { bubbles: true, composed: true }));
      }
      if (!visible) return;
      if (!this._card) {
        this._card = document.createElement('ha-card');
        this._card.style.padding = '12px 16px';
        this._text = document.createElement('pre');
        this._text.style.cssText = 'white-space:pre-wrap;font:inherit;overflow-wrap:anywhere;margin:0 0 10px';
        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.style.cssText = 'padding:8px 12px;font:inherit';
        this._button.addEventListener('click', () => this.setDeviceEnabled(!this.deviceEnabled()));
        this._card.append(this._text, this._button);
        this.append(this._card);
      }
      const optedIn = this.deviceEnabled();
      this._button.textContent = optedIn ? 'Disable on this device' : 'Enable on this device';
      this._button.setAttribute('aria-pressed', String(optedIn));
      this._button.disabled = this.config.enabled === false;
      this._text.textContent = `Room navigation: ${this.isEnabled() ? 'On' : 'Off'} on this device` +
        (storageFailures.has(globalController.deviceKey()) ?
          '\nBrowser storage unavailable. Off on this page; preference not saved for other tabs or reloads.' : '');
    }

    getCardSize() { return this.config?.mode === 'controller' ? 0 : 1; }

    getGridOptions() {
      return { columns: 12, rows: this.config?.mode === 'controller' ? 0 : 'auto', min_rows: 0 };
    }
  }

  if (!customElements.get || !customElements.get(ELEMENT)) customElements.define(ELEMENT, TabNavigator);
  if (!customElements.get || !customElements.get(DEVICE_ELEMENT)) {
    customElements.define(DEVICE_ELEMENT, class extends TabNavigator {});
  }
})();
