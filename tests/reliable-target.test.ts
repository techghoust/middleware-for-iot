import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reliableTarget } from '../src/core/reliable-target';
import { createWebhookTarget } from '../src/adapters/webhook-egress';
import { normalize } from '../src/core/normalizer';
import { MessageRouter } from '../src/core/router';
import { Dispatcher } from '../src/core/dispatcher';

const directories: string[] = [];
const servers: Server[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'databridge-'));
  directories.push(directory);
  return { attempts: 3, retryDelayMs: 1, deadLetterPath: join(directory, 'dead.jsonl') };
}
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return 'http://127.0.0.1:' + address.port;
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        })
    )
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Reliable webhook delivery', () => {
  it('routes normalized MQTT data to a real HTTP receiver and recovers after two 503 responses', async () => {
    const received: unknown[] = [];
    const url = await listen(
      createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.writeHead(received.length < 3 ? 503 : 200).end();
        });
      })
    );
    const options = await fixture();
    const dispatcher = new Dispatcher();
    dispatcher.register(reliableTarget(createWebhookTarget('webhook', url), options));
    const message = normalize('mqtt', 'home/room42/temperature', { value: 23.4 });
    const router = new MessageRouter([
      { name: 'telemetry', match: { type: 'telemetry.*' }, destinations: ['webhook'] },
    ]);
    await dispatcher.dispatch(message, router.route(message));
    expect(received).toEqual([message, message, message]);
    await expect(readFile(options.deadLetterPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists the complete message after exhausted attempts', async () => {
    const options = await fixture();
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const target = reliableTarget({ name: 'webhook', send }, options);
    const message = normalize('mqtt', 'home/temperature', { value: 2 });
    await expect(target.send(message)).rejects.toThrow('saved to');
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await readFile(options.deadLetterPath, 'utf8'))).toMatchObject({
      destination: 'webhook',
      attempts: 3,
      error: 'Error: offline',
      message,
    });
  });

  it('bounds a stalled HTTP request and saves the failure', async () => {
    const url = await listen(createServer(() => undefined));
    const options = { ...(await fixture()), attempts: 1 };
    const message = normalize('mqtt', 'home/temperature', {});
    const target = reliableTarget(createWebhookTarget('webhook', url, 30), options);
    await expect(target.send(message)).rejects.toThrow('saved to');
    expect(JSON.parse(await readFile(options.deadLetterPath, 'utf8')).message.id).toBe(message.id);
  });

  it('reports persistence failure explicitly', async () => {
    const options = await fixture();
    await writeFile(options.deadLetterPath, 'occupied');
    const target = reliableTarget(
      {
        name: 'webhook',
        send: async () => {
          throw new Error('offline');
        },
      },
      { ...options, attempts: 1, deadLetterPath: join(options.deadLetterPath, 'invalid.jsonl') }
    );
    await expect(target.send(normalize('mqtt', 'home/temp', {}))).rejects.toThrow(
      'Delivery AND dead-letter persistence failed'
    );
  });

  it('stops retrying after success', async () => {
    const options = await fixture();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValue(undefined);
    const result = reliableTarget({ name: 'webhook', send }, { ...options, retryDelayMs: 10 }).send(
      normalize('mqtt', 'home/temp', {})
    );
    await result;
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('preserves separate records for concurrent failures', async () => {
    const options = { ...(await fixture()), attempts: 1 };
    const target = reliableTarget(
      {
        name: 'webhook',
        send: async () => {
          throw new Error('offline');
        },
      },
      options
    );
    const messages = Array.from({ length: 8 }, () => normalize('mqtt', 'home/temp', {}));
    await Promise.allSettled(messages.map((message) => target.send(message)));
    const records = (await readFile(options.deadLetterPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.message.id).sort()).toEqual(
      messages.map((message) => message.id).sort()
    );
  });
});
