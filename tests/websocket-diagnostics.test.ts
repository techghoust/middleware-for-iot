import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import { WebSocketIngressAdapter } from '../src/adapters/websocket-ingress';
import { DiagnosticHub } from '../src/observability/diagnostics';
import { BridgeMessage } from '../src/types/bridge-message';

describe('WebSocket diagnostics', () => {
  it('tracks connection, malformed input, test messages and simulated loss', async () => {
    const diagnostics = new DiagnosticHub();
    const adapter = new WebSocketIngressAdapter(0, diagnostics);
    const messages: BridgeMessage[] = [];
    adapter.on('message', (message) => messages.push(message));
    const port = await adapter.ready();
    const client = new WebSocket(`ws://127.0.0.1:${port}/?clientId=sensor_04`);

    try {
      await once(client, 'open');
      expect(diagnostics.listConnections()[0]).toMatchObject({
        id: 'sensor_04',
        protocol: 'websocket',
        state: 'ONLINE',
      });

      client.send('not-json');
      const [malformed] = await once(client, 'message');
      expect(JSON.parse(malformed.toString()).ok).toBe(false);
      expect(diagnostics.listEvents({ category: 'error' })[0]).toMatchObject({
        clientId: 'sensor_04',
        type: 'protocol_error',
      });

      client.send(JSON.stringify({ type: 'temperature', payload: { value: 24.8 }, test: true }));
      const [accepted] = await once(client, 'message');
      expect(JSON.parse(accepted.toString()).ok).toBe(true);
      expect(messages[0]).toMatchObject({
        source: { id: 'sensor_04', adapter: 'websocket' },
        type: 'telemetry.temperature',
        payload: { value: 24.8 },
        meta: { test: true },
      });

      diagnostics.configureSandbox({ enabled: true, lossRate: 1 });
      client.send(JSON.stringify({ type: 'temperature', payload: { value: 99 } }));
      const [dropped] = await once(client, 'message');
      expect(JSON.parse(dropped.toString())).toEqual({
        ok: false,
        simulated: true,
        reason: 'packet_loss',
      });
      expect(messages).toHaveLength(1);

      const closedState = once(adapter, 'connection-state');
      client.close();
      await once(client, 'close');
      await closedState;
      expect(diagnostics.listConnections()[0].state).toBe('OFFLINE');
      expect(diagnostics.getMetrics()).toMatchObject({
        connectedDevices: 0,
        messagesReceived: 1,
        messagesSent: 1,
        errors: 1,
      });
    } finally {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
      await adapter.stop();
    }
  });
});
