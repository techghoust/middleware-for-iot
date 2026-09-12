## [1.1.0] - 2026-09-13

### added

- integrated diagnostics dashboard at `/diagnostics`;
- MQTT broker and WebSocket client connection-state tracking;
- bounded connection-transition and diagnostic-event history;
- event category filters and text search;
- metrics for active connections, messages, errors, reconnects and observed delivery latency;
- WebSocket test-message debugger;
- opt-in application-level latency, timeout, loss, interruption and reconnect simulation;
- graceful HTTP and WebSocket shutdown handling

### changed

- ingress, dispatcher and webhook retry paths now emit shared diagnostic events;
- test messages are marked with `meta.test`;
- sensitive keys are redacted from diagnostic events and structured logs;
- MQTT broker URLs are logged without credentials;
- diagnostics are disabled by default under `NODE_ENV=production` unless explicitly enabled;
- demo Compose publishes the dashboard and WebSocket ports on localhost

### tested

- 46 tests cover state transitions, reconnects, malformed messages, simulation, metrics, bounded history, HTTP diagnostics and cleanup

## [0.1.1]

- `WebSocketIngressAdapter` - WebSocket input adapter;
- `WEBSOCKET_PORT` configuration support;
- README updated with WebSocket usage and docs;
- `.env.example` updated;
- 20 tests passing

## [0.1.0]

- `BridgeMessage` - unified message format;
- `MqttIngressAdapter` - MQTT input adapter;
- `HttpIngressAdapter` - HTTP REST input adapter;
- `WebhookEgressAdapter` - Webhook output adapter;
- `Normalizer` - converts raw data to BridgeMessage;
- `MessageRouter` - routes messages by configurable rules;
- `Dispatcher` - delivers messages to destinations;
- `Logger` - full logging system with file output;
- `.env` support for configuration;
- ESLint + Prettier for code quality;
- 19 tests passing
