# DATABRIDGE
middleware layer for IoT systems accepts data from multiple sources, normalizes it into a single format and routes it to the right destinations

---

# THE PROBLEM
IoT projects tend to accumulate integrations. an MQTT sensor here, a REST endpoint there, a WebSocket dashboard somewhere else. each one needs its own handling, its own format, its own error logic. at some point you have more glue code than actual code. DataBridge is one layer that handles all of it

---

## HOW IT WORKS
every incoming message regardless of where it came from is converted into a `BridgeMessage` and passed through the same pipeline:

```
[ MQTT / HTTP / WebSocket ]
            ↓
       Normalizer
            ↓
         Router
            ↓
       Dispatcher
            ↓
[ Webhook / MQTT / Database ]
```
---

## CORE IDEA
all incoming data is transformed into a unified `BridgeMessage`:

```json
{
  "id": "uuid",
  "source": {
    "adapter": "mqtt",
    "id": "home/room42/temperature",
    "topic": "home/room42/temperature"
  },
  "timestamp": "2026-06-13T20:10:31.239Z",
  "type": "telemetry.temperature",
  "payload": {
    "value": 23.4,
    "unit": "celsius"
  },
  "meta": {
    "received_at": "2026-06-13T20:10:31.239Z",
    "processing_ms": 0,
    "version": "1.0"
  }
}
```
---

## COMPONENTS

### ingress adapters
- MQTT (Eclipse Mosquitto compatible);
- HTTP REST (`POST /ingest/:type`)

### corepipline
- Normalizer: validates and transforms raw input into BridgeMessage;
- Router: matches event types using wildcard rules (e.g. `telemetry.*`);
- Dispatcher: delivers messages to targets with error handling

### egress adapters
- Webhook (HTTP forwarding);
- Extensible output system

### observability
- structured logger: debug / info / warn / error;
- colored console output;
- file logs:
  `logs/databridge.log`
  `logs/errors.log`
  
---

## GETTING STARTED

### requirements
- Node.js 18+;
- Docker (MQTT broker)

### installation

```bash
git clone https://github.com/techghoust/middleware-for-iot.git
cd databridge
npm install
```

```bash
cp .env.example .env
```

### start mqtt broker

```bash
docker compose up -d
```

Runs Eclipse Mosquitto on port 1883

### run the system

```bash
npm run dev
```

Expected output:

```
[INFO] Dispatcher registered target: console
[INFO] Router loaded routing rules
[INFO] DataBridge started
[INFO] HTTP listening on port 3000
[INFO] MQTT connected to mqtt://localhost:1883
[INFO] MQTT subscribed to home/#
```
---

## SENDING DATA

### mqtt
topics:

```
home/room42/temperature
home/kitchen/humidity
```

test script:

```bash
npx ts-node src/test-publish.ts
```

### http

```bash
curl -X POST http://localhost:3000/ingest/temperature \
  -H "Content-Type: application/json" \
  -d '{"value": 23.4, "unit": "celsius"}'
```

response:

```json
{ "ok": true, "id": "uuid" }
```
---

## configuration

```env
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPICS=home/#
HTTP_PORT=3000
LOG_LEVEL=info
```
---

## PROJECT STRUCTURE

```
src/
  adapters/
    mqtt-ingress.ts
    http-ingress.ts
    webhook-egress.ts

  core/
    normalizer.ts
    router.ts
    dispatcher.ts

  types/
    bridge-message.ts

  observability/
    logger.ts

  config.ts
  index.ts
  test-publish.ts

tests/
  normalizer.test.ts
  router.test.ts
  dispatcher.test.ts
  mqtt-ingress.test.ts
  http-ingress.test.ts
  webhook-egress.test.ts
  logger.test.ts

docker/
  mosquitto.conf

.github/
  workflows/
    ci.yml
  ISSUE_TEMPLATE/
    bug_report.md
    feature_request.md
```
---

## TESTING

```bash
npm test
```

built with Vitest (19 tests)

```bash
npm run lint
npm run format
```
---

## ADDING A NEW ADAPTER
all ingress adapters emit a normalized BridgeMessage:

```typescript
import { EventEmitter } from 'events';
import { normalize } from '../core/normalizer';

export class MyAdapter extends EventEmitter {
  constructor() {
    super();
    const msg = normalize('my-adapter', 'topic', rawData);
    this.emit('message', msg);
  }
}
```

register it in `index.ts` and it becomes part of the pipeline

---

## TECH STACK
- Node.js + TypeScript;
- Fastify;
- mqtt.js;
- Zod;
- Vitest;
- Docker (Mosquitto);
- ESLint + Prettier
  
---

## ROADMAP
- WebSocket ingress/egress;
- YAML routing config;
- Dead letter queue;
- Retry with backoff;
- Web dashboard;
- npm package release
  
---

## LICENCE
MIT

---

## CONTRIBUTING
see [CONTRIBUTING.md](CONTRIBUTING.md)