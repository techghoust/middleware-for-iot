import { describe, expect, it } from 'vitest';
import { HttpIngressAdapter } from '../src/adapters/http-ingress';
import { DiagnosticHub } from '../src/observability/diagnostics';
import { BridgeMessage } from '../src/types/bridge-message';

describe('diagnostics HTTP interface', () => {
  it('serves the dashboard, filters events and controls the sandbox', async () => {
    const diagnostics = new DiagnosticHub();
    diagnostics.record({
      category: 'connection',
      type: 'sample',
      message: 'sensor online',
      clientId: 'sensor-1',
      protocol: 'websocket',
    });
    diagnostics.recordError('system', 'sample_error', 'sample failure');
    const adapter = new HttpIngressAdapter(0, diagnostics, 4321);
    const messages: BridgeMessage[] = [];
    adapter.on('message', (message) => messages.push(message));

    try {
      const port = await adapter.ready();
      const baseUrl = `http://127.0.0.1:${port}`;
      const page = await fetch(baseUrl + '/diagnostics');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('DataBridge diagnostics');

      const snapshotResponse = await fetch(
        baseUrl + '/diagnostics/api/snapshot?category=error&search=sample&limit=10'
      );
      const snapshot = (await snapshotResponse.json()) as {
        events: Array<{ category: string; type: string }>;
        sandbox: { enabled: boolean };
      };
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toMatchObject({ category: 'error', type: 'sample_error' });
      expect(snapshot.sandbox.enabled).toBe(false);

      const invalid = await fetch(baseUrl + '/diagnostics/api/sandbox', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, lossRate: 2 }),
      });
      expect(invalid.status).toBe(400);

      const configured = await fetch(baseUrl + '/diagnostics/api/sandbox', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, latencyMs: 25, lossRate: 0, timeoutMs: 0 }),
      });
      expect(await configured.json()).toMatchObject({ enabled: true, latencyMs: 25 });

      const accepted = await fetch(baseUrl + '/ingest/temperature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-databridge-test': 'true' },
        body: JSON.stringify({ value: 21 }),
      });
      expect(accepted.status).toBe(200);
      expect(messages[0]).toMatchObject({
        source: { adapter: 'http' },
        type: 'telemetry.temperature',
        payload: { value: 21 },
        meta: { test: true },
      });

      const reset = await fetch(baseUrl + '/diagnostics/api/sandbox/reset', { method: 'POST' });
      expect(await reset.json()).toEqual({
        enabled: false,
        latencyMs: 0,
        lossRate: 0,
        timeoutMs: 0,
        interruptNext: false,
      });
    } finally {
      await adapter.stop();
    }
  });

  it('does not expose diagnostics routes when disabled', async () => {
    const adapter = new HttpIngressAdapter(0, new DiagnosticHub(), 4321, false);
    try {
      const port = await adapter.ready();
      expect((await fetch(`http://127.0.0.1:${port}/diagnostics`)).status).toBe(404);
    } finally {
      await adapter.stop();
    }
  });
});
