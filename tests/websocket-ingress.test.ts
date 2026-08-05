import { describe, it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import { WebSocketIngressAdapter } from '../src/adapters/websocket-ingress';

describe('WebSocketIngressAdapter', () => {
  const port = 3002;
  const adapter = new WebSocketIngressAdapter(port);
  const messages: any[] = [];

  adapter.on('message', (msg) => {
    messages.push(msg);
  });

  afterAll(async () => {
    await adapter.stop();
  });

  it('accepts WebSocket messages and emits BridgeMessage', async () => {
    const client = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    const payload = { type: 'temperature', payload: { value: 22.4, unit: 'celsius' } };
    client.send(JSON.stringify(payload));

    await new Promise<void>((resolve, reject) => {
      client.on('message', (data) => {
        const response = JSON.parse(data.toString());
        expect(response.ok).toBe(true);
        expect(response.id).toBeDefined();
        client.close();
        resolve();
      });
      client.on('error', reject);
    });
  });

  it('emits correct BridgeMessage', async () => {
    const client = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    const payload = { type: 'humidity', payload: { value: 45 } };
    client.send(JSON.stringify(payload));

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const last = messages[messages.length - 1];

    expect(last.type).toBe('telemetry.humidity');
    expect(last.source.adapter).toBe('websocket');
    expect(last.payload).toEqual({ value: 45 });

    client.close();
  });
});
