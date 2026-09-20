# Tab Navigator

A minimal, opt-in Home Assistant Lovelace card that navigates the current browser to a tab derived from the logged-in user's configured entity state.

It is intentionally generic: it does not know about rooms, phones, desktops, or Pi displays. Mount the card only on the dashboard/browser where navigation is wanted. It never calls a Home Assistant service and never writes entity state.

![Illustrative flow: the logged-in user's configured sensor maps its state to a tab in the current browser only.](https://raw.githubusercontent.com/m4rkireland/tab-navigator/main/docs/routing.svg)

This schematic uses generic examples; it is not a device screenshot. While the dashboard is open, each user follows their own configured sensor as Home Assistant delivers updates. Physical iPhone Companion App (WKWebView) background/resume behavior has not been verified.

## Install with HACS

1. In HACS, add `https://github.com/m4rkireland/tab-navigator` as a **custom repository** of type **Dashboard**.
2. Download **Tab Navigator**.
3. Add the resource if HACS does not do so automatically:
   `/hacsfiles/tab-navigator/tab-navigator.js`
   with resource type `JavaScript module`.
4. Add the card to a dashboard. Existing dashboards are not changed by installation.

## Card configuration

```yaml
type: custom:tab-navigator
enabled: true
base_path: /phone-room-test/
user_entities:
  YOUR_HA_USER_ID: sensor.your_presence_area
state_paths:
  Kitchen: kitchen
  Office: office
default_tab: overview
manual_grace_seconds: 30
```

`user_entities` maps a Home Assistant user ID to that user's entity. `state_paths` maps the entity state to a relative URL path under `base_path`. Unknown users are a no-op. An unmapped state uses `default_tab`; omit `default_tab` for no navigation. The legacy aliases `users` and `tabs` are also accepted for the phone trial.

The visible diagnostic card shows the resolved user/entity/state/target and includes a **Navigate now** action. That action only causes the same local URL replacement; it makes no service call.

## Safety and behavior

- Navigation is restricted to the configured `base_path`.
- URL replacement preserves the existing browser history state and emits Home Assistant's `location-changed` event.
- Edit mode, dialogs, background tabs, disconnected HA, and disabled cards are guarded.
- Manual navigation receives a per-card grace period before a later state/foreground event can auto-navigate again.
- Session diagnostics are keyed by the logged-in user ID; no navigation state is shared between users.
- The plugin reacts to HA state deliveries, `visibilitychange`, `pageshow`, and navigation events. It does not poll.
- The state is only as fresh as the data delivered to the current HA page; this is not proof of fresh sensor data.
- Installation alone does nothing. No dashboard is migrated or altered by this repository.

## Development

```sh
npm test
node --check tab-navigator.js
```

## License

MIT
