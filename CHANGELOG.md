## in [0.1.1] was added
- `WebSocketIngressAdapter` - WebSocket input adapter;
- `WEBSOCKET_PORT` configuration support;
- README updated with WebSocket usage and docs;
- `.env.example` updated;
- 20 tests passing

## in [0.1.0] was added
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