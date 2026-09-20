# Tab Navigator

A minimal Home Assistant Lovelace card that navigates the current browser to a tab derived from the logged-in user's configured entity state. **Navigation is OFF on every browser until explicitly enabled there.** No HA services, helpers, or entity writes are used.

![Illustrative flow: the logged-in user's configured sensor maps its state to a tab in the current browser only.](https://raw.githubusercontent.com/m4rkireland/tab-navigator/main/docs/routing.svg)

This schematic is not a device screenshot. Physical iPhone Companion App (WKWebView) background/resume behavior has not been verified.

## Install with HACS

1. Add `https://github.com/m4rkireland/tab-navigator` as a HACS **custom repository**, type **Dashboard**.
2. Download **Tab Navigator**.
3. If HACS does not add it automatically, add `/hacsfiles/tab-navigator/tab-navigator.js` as a **JavaScript module** resource.
4. Configure the cards below. Installation does not change dashboards or activate any browser.

## Per-device activation

On the **actual browser or Companion app** you want to follow your sensor, open the dashboard's activation card and choose **Enable on this device**. The card shows **On/Off on this device** and provides **Disable on this device**. Other browsers, phones and fixed displays remain off, even with the same HA login. Unmapped users see no card and cannot navigate.

“Device” means **this browser/app's local storage on this HA origin**, not hardware detection. The preference is keyed by HA user ID and dashboard `base_path`. Tabs in the same browser profile on the same origin share activation; another browser/app/profile or HA origin is separate. Clearing app/site storage, reinstalling the app, or private browsing expiry requires re-enabling. Storage failure is fail-closed. This frontend preference is not an authentication or access-control boundary.

## Configuration

Place this minimal activation control on a convenient view such as Home:

```yaml
type: custom:tab-navigator-device
mode: control
require_device_opt_in: true
base_path: /my-dashboard/
user_entities:
  YOUR_HA_USER_ID: sensor.your_presence_area
```

Place this invisible controller in an **existing section on every view** that can be visited, including Home. Do not create an otherwise empty section for it:

```yaml
type: custom:tab-navigator-device
mode: controller
require_device_opt_in: true
base_path: /my-dashboard/
user_entities:
  YOUR_HA_USER_ID: sensor.your_presence_area
state_paths:
  Kitchen: kitchen
  Office: office
manual_grace_seconds: 30
```

Use identical user, base-path, and routing configuration across controllers. `mode: control` never navigates itself. `mode: controller` creates no UI and uses Home Assistant's `hidden`, `connectedWhileHidden`, and `card-visibility-changed` lifecycle contract to remove its wrapper/grid slot while remaining connected. Sections layout is verified with HA 2026.9.3. Card sizing alone is not the hiding mechanism; use a current HA frontend that supports this contract.

Omit `mode` (or use `mode: diagnostic`) for the diagnostic card, which displays user/entity/state/target and the device activation button. Only configured users see it.

`user_entities` maps an HA user ID to that user's entity. `state_paths` maps entity states to relative URL paths within `base_path`. Unmapped users are always a no-op. An unmapped state uses optional `default_tab`; **omit `default_tab` for no navigation on unknown, unavailable, away, or other unmapped states**. Legacy aliases `users` and `tabs` remain accepted.

### Cache-safe deployment (v1.0.3)

Use `custom:tab-navigator-device` for new device-scoped installations. A browser still holding v1.0.1 cannot resolve that new element to its old, globally enabled implementation. A stale client may show an unknown-card message until it refreshes, but cannot navigate from these new cards. Refresh/reopen HA after upgrading. The original `custom:tab-navigator` name remains supported for existing installations.

### Upgrading from v1.0.1

The safe default in v1.0.2 is device opt-in, including existing configurations: `enabled: true` alone no longer activates all clients. Existing diagnostic cards now offer the local activation button. For an explicitly intended legacy all-client installation only, `require_device_opt_in: false` restores configuration-only activation and the diagnostic **Navigate now** button. **Do not use that override on shared dashboards where a phone should follow presence but a desktop/Pi should not.** `enabled: false` remains a configuration-wide kill switch, not a device preference.

## Safety and behavior

- Only the current browser URL is replaced, preserving history state and emitting HA's `location-changed` event.
- Navigation is restricted to `base_path`; edit mode, dialogs, background tabs, disconnected HA and disabled devices are guarded, including immediately before a pending navigation fires.
- Disabling cancels pending navigation immediately. Same-page controls synchronize by a local event; other same-origin tabs receive storage events and also re-read the preference before navigation.
- Manual navigation grants 30 seconds of grace by default, preserved across view/card remounts and scoped to user/dashboard in this tab's session storage. Navigate to Home normally to reach Disable without being redirected during that grace. After grace, a later state/foreground/reconnect event can navigate again; there is no polling or grace-expiry timer.
- Only one mounted controller per user/dashboard owns navigation in a page; detached cards cancel timers and remove listeners.
- HA state updates, reconnection, `visibilitychange` and `pageshow` trigger re-evaluation. Sensor data is only as fresh as HA delivers; this cannot make a stale phone sensor fresh.
- No shared mutable navigation state is written to HA. Dashboard defaults and other dashboards are not changed by this plugin.

## Development

```sh
npm test
node --check tab-navigator.js
```

The isolated frontend tests cover separate browsers with the same login, user/dashboard separation, same-browser tabs, instant opt-out, hidden-card lifecycle, controller ownership, manual grace, storage failure, reconnect/foreground, unknown/away and detached elements. They do not mutate household sensors.

## License

MIT
