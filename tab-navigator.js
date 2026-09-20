/*
 * Tab Navigator — a small, opt-in Home Assistant Lovelace card.
 * It only replaces the current URL inside the configured dashboard scope.
 * It never calls HA services or writes entity state.
 */
(function registerTabNavigator() {
  const ELEMENT = 'tab-navigator';

  function mapFor(config, primary, legacy) {
    const value = config && (config[primary] ?? config[legacy]);
    return value && typeof value === 'object' ? value : {};
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

  class TabNavigator extends HTMLElement {
    static resolve(hass, config) {
      const users = mapFor(config, 'user_entities', 'users');
      const paths = mapFor(config, 'state_paths', 'tabs');
      const userId = hass && hass.user && hass.user.id;
      const entityId = userId ? users[userId] : null;
      if (!entityId) return null;
      const state = hass.states && hass.states[entityId] && hass.states[entityId].state;
      const mapped = safePath(paths[state]);
      if (mapped) return mapped;
      return safePath(config && config.default_tab);
    }

    setConfig(config) {
      this.config = config && typeof config === 'object' ? config : {};
      this._pendingReason = 'configuration loaded';
      this.check();
    }

    connectedCallback() {
      this._pendingReason = this._pendingReason || 'card loaded';
      this._manualHoldUntil = 0;
      this._onVisibility = () => {
        if (document.visibilityState === 'visible') {
          this._pendingReason = 'foreground';
          this.check();
        } else {
          this.log('backgrounded; navigation paused');
        }
      };
      this._onPageShow = () => {
        this._pendingReason = 'pageshow';
        this.check();
      };
      this._onLocationChanged = (event) => {
        if (event && event.detail && event.detail.tabNavigator === true) return;
        if (this.isInScope()) {
          this._manualHoldUntil = Date.now() + this.graceMs();
          this.log(`manual navigation detected; auto-navigation paused for ${this.graceMs() / 1000}s`);
        }
        this.render();
      };
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('pageshow', this._onPageShow);
      window.addEventListener('location-changed', this._onLocationChanged);
      window.addEventListener('popstate', this._onLocationChanged);
      this.check();
    }

    disconnectedCallback() {
      document.removeEventListener('visibilitychange', this._onVisibility);
      window.removeEventListener('pageshow', this._onPageShow);
      window.removeEventListener('location-changed', this._onLocationChanged);
      window.removeEventListener('popstate', this._onLocationChanged);
      this.cancelPending();
    }

    set hass(value) {
      const wasConnected = this._connected;
      const nowConnected = Boolean(value && value.connection && value.connection.connected === true);
      const previousKey = this._stateKey;
      this._hass = value;
      this._connected = nowConnected;
      this._stateKey = this.stateKey();
      if (wasConnected === false && nowConnected) this._pendingReason = 'HA reconnected';
      else if (previousKey !== undefined && previousKey !== this._stateKey) this._pendingReason = 'state update';
      this.check();
    }

    get hass() { return this._hass; }

    stateKey() {
      const user = this._hass && this._hass.user;
      const users = mapFor(this.config, 'user_entities', 'users');
      const entity = user && users[user.id];
      return `${user && user.id || ''}|${entity || ''}|${entity && this._hass.states && this._hass.states[entity] ? this._hass.states[entity].state : ''}`;
    }

    graceMs() {
      const seconds = Number(this.config && this.config.manual_grace_seconds);
      return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 30000;
    }

    storageKey() {
      return `tab-navigator-v1:${this._hass && this._hass.user ? this._hass.user.id : 'unknown'}`;
    }

    logs() {
      try { return JSON.parse(sessionStorage.getItem(this.storageKey()) || '[]'); }
      catch (_) { return []; }
    }

    log(message) {
      if (!this._hass || !this._hass.user) return;
      const lines = this.logs();
      lines.push(`${new Date().toLocaleTimeString()} — ${message}`);
      try { sessionStorage.setItem(this.storageKey(), JSON.stringify(lines.slice(-10))); }
      catch (_) { /* sessionStorage is optional */ }
    }

    isEnabled() { return this.config.enabled !== false; }

    isConnected() { return this._connected === true; }

    isInScope() {
      return typeof location !== 'undefined' && location.pathname.startsWith(basePath(this.config.base_path));
    }

    isGuarded() {
      return typeof location !== 'undefined' &&
        (location.search.includes('edit') || Boolean(history.state && history.state.dialog));
    }

    targetPath() {
      const tab = TabNavigator.resolve(this._hass, this.config);
      return tab ? `${basePath(this.config.base_path)}${tab}` : null;
    }

    cancelPending() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }

    check() {
      if (this.isConnected() && this.config && this.isConnectedElement()) this.render();
      if (!this.isEnabled() || !this.isConnected() || !this.config || !this.isConnectedElement()) return;
      if (!this._pendingReason || this._timer || document.visibilityState !== 'visible') return;
      if (!this.isInScope() || this.isGuarded()) return;
      if (Date.now() < (this._manualHoldUntil || 0)) return;

      const reason = this._pendingReason;
      this._pendingReason = null;
      this._timer = setTimeout(() => {
        this._timer = null;
        if (!this.isEnabled() || !this.isConnected() || !this.isConnectedElement() ||
            document.visibilityState !== 'visible' || !this.isInScope() || this.isGuarded()) return;
        if (Date.now() < (this._manualHoldUntil || 0)) return;
        const target = this.targetPath();
        if (!target) {
          this.log(`${reason}: user not enabled or state unmapped; no navigation`);
          this.render();
          return;
        }
        if (location.pathname === target) {
          this.log(`${reason}: ${target} (already here)`);
        } else {
          this.log(`${reason}: ${target} → navigate`);
          history.replaceState(history.state, '', target);
          window.dispatchEvent(new CustomEvent('location-changed', {
            detail: { replace: true, tabNavigator: true },
          }));
        }
        this.render();
      }, 300);
    }

    isConnectedElement() { return this.isConnected !== false; }

    render() {
      if (!this._hass || !this._hass.user || typeof document === 'undefined') return;
      if (!this._card) {
        this._card = document.createElement('ha-card');
        this._card.style.padding = '12px 16px';
        this._text = document.createElement('pre');
        this._text.style.cssText = 'white-space:pre-wrap;font:inherit;overflow-wrap:anywhere;margin:0 0 10px';
        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.textContent = 'Navigate now';
        this._button.style.cssText = 'padding:8px 12px;font:inherit';
        this._button.addEventListener('click', () => {
          this._manualHoldUntil = 0;
          this._pendingReason = 'manual check';
          this.check();
        });
        this._card.append(this._text, this._button);
        this.append(this._card);
      }
      const users = mapFor(this.config, 'user_entities', 'users');
      const entity = users[this._hass.user.id];
      const state = entity && this._hass.states && this._hass.states[entity] ? this._hass.states[entity].state : 'unknown';
      const target = TabNavigator.resolve(this._hass, this.config);
      const remaining = Math.max(0, Math.ceil(((this._manualHoldUntil || 0) - Date.now()) / 1000));
      this._text.textContent = `TAB NAVIGATOR\nUser: ${this._hass.user.name || this._hass.user.id}\nEnabled: ${entity ? 'yes' : 'no'}\nEntity: ${entity || 'none'}\nState: ${state}\nTarget tab: ${target || 'none'}\n${remaining ? `Manual navigation hold: ${remaining}s\n` : ''}Scope: ${basePath(this.config.base_path)}\nNo service calls or entity writes.`;
    }

    getCardSize() { return 3; }
  }

  if (!customElements.get || !customElements.get(ELEMENT)) customElements.define(ELEMENT, TabNavigator);
})();
