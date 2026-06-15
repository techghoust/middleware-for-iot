import { describe, it, expect, afterAll } from 'vitest';
import { HttpIngressAdapter } from '../src/adapters/http-ingress';

describe('HttpIngressAdapter', () => {
  const adapter = new HttpIngressAdapter(3001);
  const messages: any[] = [];

  adapter.on('message', (msg) => {
    messages.push(msg);
  });

  afterAll(async () => {
    await adapter.stop();
  });

  it('accepts POST and emits BridgeMessage', async () => {
    const response = await fetch('http://localhost:3001/ingest/temperature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 25.0, unit: 'celsius' }),
    });

    const data = (await response.json()) as { ok: boolean; id: string };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.id).toBeDefined();
  });

  it('emits correct BridgeMessage', async () => {
    await fetch('http://localhost:3001/ingest/humidity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 60 }),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const last = messages[messages.length - 1];
    expect(last.type).toBe('telemetry.humidity');
    expect(last.source.adapter).toBe('http');
    expect(last.payload).toEqual({ value: 60 });
  });
});
