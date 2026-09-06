import { describe, expect, it } from 'vitest';
import { Aedes } from 'aedes';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt from 'mqtt';
import { MqttIngressAdapter } from '../src/adapters/mqtt-ingress';
import { createWebhookTarget } from '../src/adapters/webhook-egress';
import { reliableTarget } from '../src/core/reliable-target';
import { Dispatcher } from '../src/core/dispatcher';
import { MessageRouter } from '../src/core/router';
import { BridgeMessage } from '../src/types/bridge-message';

describe('MQTT → webhook over real sockets', () => {
  it.each([0, 2, 99])(
    'handles a receiver failing its first %i attempts',
    async (failFirst) => {
      const directory = await mkdtemp(join(tmpdir(), 'databridge-e2e-'));
      const broker = await Aedes.createBroker();
      const tcp = createTcpServer(broker.handle);
      const received: BridgeMessage[] = [];
      const http = createHttpServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.writeHead(received.length <= failFirst ? 503 : 200).end();
        });
      });
      let ingress: MqttIngressAdapter | undefined;
      let publisher: mqtt.MqttClient | undefined;
      try {
        tcp.listen(0, '127.0.0.1');
        await once(tcp, 'listening');
        http.listen(0, '127.0.0.1');
        await once(http, 'listening');
        const tcpAddress = tcp.address();
        const httpAddress = http.address();
        if (
          !tcpAddress ||
          typeof tcpAddress === 'string' ||
          !httpAddress ||
          typeof httpAddress === 'string'
        ) {
          throw new Error('Missing listening address');
        }
        const mqttUrl = 'mqtt://127.0.0.1:' + tcpAddress.port;
        const deadLetterPath = join(directory, 'dead.jsonl');
        const dispatcher = new Dispatcher();
        dispatcher.register(
          reliableTarget(
            createWebhookTarget('webhook', 'http://127.0.0.1:' + httpAddress.port, 1000),
            { attempts: 3, retryDelayMs: 1, deadLetterPath }
          )
        );
        const router = new MessageRouter([
          { name: 'telemetry', match: { type: 'telemetry.*' }, destinations: ['webhook'] },
        ]);
        const subscribed = once(broker, 'subscribe', { signal: AbortSignal.timeout(3000) });
        ingress = new MqttIngressAdapter(mqttUrl, ['home/#']);
        let complete!: () => void;
        const delivered = new Promise<void>((resolve) => {
          complete = resolve;
        });
        let dispatch: Promise<void> | undefined;
        ingress.on('message', (message: BridgeMessage) => {
          dispatch = dispatcher.dispatch(message, router.route(message)).finally(complete);
        });
        await subscribed;
        publisher = await mqtt.connectAsync(mqttUrl);
        await publisher.publishAsync('home/room42/temperature', JSON.stringify({ value: 23.4 }), {
          qos: 1,
        });
        await delivered;
        await dispatch;
        expect(received).toHaveLength(Math.min(failFirst + 1, 3));
        expect(received[0]).toMatchObject({
          source: { adapter: 'mqtt', topic: 'home/room42/temperature' },
          type: 'telemetry.temperature',
          payload: { value: 23.4 },
        });
        expect(new Set(received.map((message) => message.id)).size).toBe(1);
        if (failFirst > 2) {
          expect(JSON.parse(await readFile(deadLetterPath, 'utf8'))).toMatchObject({
            destination: 'webhook',
            attempts: 3,
            message: received[0],
          });
        } else {
          await expect(readFile(deadLetterPath)).rejects.toMatchObject({ code: 'ENOENT' });
        }
      } finally {
        await publisher?.endAsync(true);
        ingress?.disconnect();
        await new Promise<void>((resolve) => broker.close(() => resolve()));
        await new Promise<void>((resolve) => tcp.close(() => resolve()));
        await new Promise<void>((resolve) => {
          http.close(() => resolve());
          http.closeAllConnections();
        });
        await rm(directory, { recursive: true, force: true });
      }
    },
    10000
  );
});
