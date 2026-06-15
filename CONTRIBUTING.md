## GETTING STARTED
1. fork the repository;
2. clone your fork:
```bash
   git clone https://github.com/techghoust/middleware-for-iot.git
   cd databridge
```
3. install dependencies:
```bash
   npm install
```
4. start the MQTT broker:
```bash
   docker compose up -d
```

## DEVELOPMENT WORKFLOW

run tests:
```bash
npm test
```

check code style:
```bash
npm run lint
```

format code:
```bash
npm run format
```

adding a new adapter:
1. create a new file in `src/adapters/`;
2. extend `EventEmitter` for ingress adapters;
3. use `normalize()` to convert raw data to `BridgeMessage`;
4. emit `message` event with the normalized message;
5. write tests in `tests/`

## PROJECT STRUCTURE
src/
  adapters/
  core/
  types/
  observability/

tests/

docker/

## COMMITE MESSAGE
use clear and descriptive commit messages:
- `feat: add WebSocket ingress adapter`;
- `fix: handle invalid MQTT payload`;
- `test: add router wildcard tests`;
- `docs: update README`