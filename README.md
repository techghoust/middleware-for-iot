# DATABRIDGE

middleware layer for IoT systems accepts data from multiple sources, normalizes it into a single format and routes it to the right destinations

current version: `1.1.0`

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
[ Webhook / Console ]
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
- WebSocket ingress (`ws://localhost:3002`)

### core pipeline

- normalizer: accepts non-null objects (including arrays) and wraps them in a `BridgeMessage`; payload fields are not validated;
- Router: matches event types using wildcard rules (e.g. `telemetry.*`);
- Dispatcher: delivers messages to targets with error handling

### egress adapters

- Webhook (HTTP forwarding);
- Extensible output system

### observability

- structured logger: debug / info / warn / error;
- colored console output;
- connection state and transition history;
- bounded event viewer with filtering and search;
- runtime metrics derived from observed events;
- opt-in protocol sandbox;
- WebSocket message debugger;
- file logs:
  `logs/databridge.log`
  `logs/errors.log`

---

## GETTING STARTED

### requirements

- Node.js 24;
- Docker (MQTT broker)

### installation

```bash
git clone https://github.com/techghoust/middleware-for-iot.git
cd middleware-for-iot/databridge
npm install
```

```bash
cp .env.example .env
```

### start mqtt broker

```bash
docker compose up -d mqtt
```

runs Eclipse Mosquitto on port 1883

for the webhook configured in `.env.example`, start the local receiver in another terminal:

```bash
node demo/webhook.cjs
```

### run the system

```bash
npm run dev
```

expected output:

```
[INFO] Dispatcher registered target: console
[INFO] Router loaded routing rules
[INFO] DataBridge started
[INFO] HTTP listening on port 3000
[INFO] MQTT connected to mqtt://localhost:1883
[INFO] MQTT subscribed to home/#
[INFO] WebSocket listening on port 3002
```

---

## reproducible MQTT -> webhook demo

from the `databridge` directory:

```sh
docker compose up --build -d
docker compose logs -f bridge webhook
```

wait for the MQTT subscription, then publish a message in another terminal:

```sh
docker compose exec mqtt mosquitto_pub -h localhost -t home/room42/temperature -m '{"value":23.4,"unit":"celsius"}'
```

expected result:

- the bridge receives `telemetry.temperature`;
- the webhook returns status `200`;
- the webhook log contains the normalized message

the anonymous demo broker is available only on localhost. the bridge and webhook communicate through the internal Compose network.

### exercise failures (PowerShell)

```powershell
$env:DEMO_FAIL_FIRST = '2'
docker compose up -d --force-recreate webhook
```

publish a new message. the webhook returns `503`, `503`, then `200` with the same message ID.

to exhaust all attempts:

1. set `DEMO_FAIL_FIRST` to `99`;
2. recreate the webhook;
3. publish another message;
4. inspect the failure record:

```sh
docker compose exec bridge cat /app/data/dead-letters.jsonl
```

to restore normal operation, set `DEMO_FAIL_FIRST` to `0` and recreate the webhook.

stop the demo:

```sh
docker compose down
```

the named data volume is retained.

### delivery contract

- `WEBHOOK_URL` enables webhook routing. without it, messages go only to the console;
- `WEBHOOK_TIMEOUT_MS` limits each request;
- `WEBHOOK_ATTEMPTS` includes the initial attempt;
- `WEBHOOK_RETRY_DELAY_MS` doubles between retries and is capped at 60 seconds;
- `DEAD_LETTER_PATH` stores exhausted deliveries as JSONL records

each failure record contains the message, destination, error and attempt count. replay is manual.

retries can produce duplicates. receivers should deduplicate messages by `BridgeMessage.id`.

this is not a durable input queue. process termination can lose an in-flight message.

HTTP/WebSocket `ok` confirms normalization and acceptance for processing. it does not confirm downstream delivery.

### local development

requirements:

- Node.js 24;
- `.env` copied from `.env.example`;
- `WEBHOOK_URL` configured for forwarding

run the broker:

```sh
docker compose up -d mqtt
```

run the webhook in another terminal:

```sh
node demo/webhook.cjs
```

run the bridge:

```sh
npm ci
npm run dev
```

verification:

```sh
npm run build
npm run lint
npm test
```

---

## DIAGNOSTICS

start DataBridge and open:

```text
http://localhost:3000/diagnostics
```

the dashboard is enabled by default during local development. under `NODE_ENV=production`, set `DIAGNOSTICS_ENABLED=true` explicitly. do not expose the diagnostics routes to an untrusted network without access control.

the dashboard shows:

- current MQTT and WebSocket connection states;
- recent state transitions;
- bounded event and message history;
- event category filters and text search;
- received, sent, error, reconnect and observed latency metrics;
- a WebSocket test-message debugger;
- protocol simulation controls

connection states reflect events the middleware can actually observe. WebSocket clients are tracked separately. MQTT state describes the broker connection because MQTT messages do not expose a persistent device connection to this process.

### protocol sandbox

simulation is disabled by default. enable it from the dashboard or with `SANDBOX_ENABLED=true`.

available conditions:

- artificial message latency;
- timeout and retry transitions when latency reaches the configured timeout;
- application-level message loss;
- one-shot connection interruption and reconnect simulation

active settings are always shown at the top of the dashboard. use `disable / reset` to clear all simulation settings.

simulation changes only application-level message handling. it does not modify the operating system or physical network.

`SANDBOX_LOSS_RATE` uses a value from `0` to `1`. for example, `0.25` means 25% simulated loss.

events are limited by `DIAGNOSTICS_MAX_EVENTS`. inactive connection history is limited by `DIAGNOSTICS_MAX_CONNECTIONS`. active connections remain visible. fields named like passwords, tokens, authorization headers, cookies and API keys are redacted before display or logging.

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

`ok: true` means the message was normalized and accepted for processing. it does not confirm delivery to a destination.

### websocket

use a WebSocket client to connect to the configured port and send a JSON payload:

```json
{ "type": "temperature", "payload": { "value": 23.4, "unit": "celsius" } }
```

example client URL:

```
ws://localhost:3002
```

the adapter will reply with:

```json
{ "ok": true, "id": "uuid" }
```

`ok: true` means the message was normalized and accepted for processing. it does not confirm delivery to a destination.

---

## configuration

```env
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPICS=home/#
HTTP_PORT=3000
WEBSOCKET_PORT=3002
LOG_LEVEL=info
DIAGNOSTICS_ENABLED=true
DIAGNOSTICS_MAX_EVENTS=500
DIAGNOSTICS_MAX_CONNECTIONS=1000
SANDBOX_ENABLED=false
SANDBOX_LATENCY_MS=0
SANDBOX_LOSS_RATE=0
SANDBOX_TIMEOUT_MS=0
```

---

## PROJECT STRUCTURE

```
src/
  adapters/
    mqtt-ingress.ts
    http-ingress.ts
    websocket-ingress.ts
    webhook-egress.ts

  core/
    normalizer.ts
    router.ts
    dispatcher.ts
    reliable-target.ts

  types/
    bridge-message.ts

  observability/
    dashboard.ts
    diagnostics.ts
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
  websocket-ingress.test.ts
  webhook-egress.test.ts
  logger.test.ts
  diagnostics.test.ts
  diagnostics-http.test.ts
  websocket-diagnostics.test.ts

demo/
  mosquitto.conf
  webhook.cjs

compose.yaml
Dockerfile

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

built with Vitest

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

- WebSocket egress support;
- YAML routing config;
- automatic dead-letter replay;
- durable input queue;
- npm package release

---

## LICENCE

MIT

---

## CONTRIBUTING

see [CONTRIBUTING.md](CONTRIBUTING.md)
