import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockClient = new EventEmitter() as any;
mockClient.subscribe = vi.fn();
mockClient.end = vi.fn();

vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(() => mockClient),
  },
}));

import { MqttIngressAdapter } from '../src/adapters/mqtt-ingress';
import { DiagnosticHub } from '../src/observability/diagnostics';

describe('MqttIngressAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.removeAllListeners();
  });

  it('subscribes to topics on connect', () => {
    new MqttIngressAdapter('mqtt://localhost', ['home/temp', 'home/humidity']);
    mockClient.emit('connect');

    expect(mockClient.subscribe).toHaveBeenCalledWith('home/temp');
    expect(mockClient.subscribe).toHaveBeenCalledWith('home/humidity');
  });

  it('emits BridgeMessage on incoming message', () =>
    new Promise<void>((resolve) => {
      const adapter = new MqttIngressAdapter('mqtt://localhost', ['home/temp']);
      mockClient.emit('connect');

      adapter.on('message', (msg) => {
        expect(msg.type).toBe('telemetry.temp');
        expect(msg.payload).toEqual({ value: 21.5 });
        expect(msg.source.adapter).toBe('mqtt');
        resolve();
      });

      mockClient.emit('message', 'home/temp', Buffer.from(JSON.stringify({ value: 21.5 })));
    }));

  it('tracks connect, retry, error and offline states', () => {
    const diagnostics = new DiagnosticHub();
    new MqttIngressAdapter('mqtt://user:password@localhost:1883', ['home/#'], diagnostics);
    expect(diagnostics.listConnections()[0].state).toBe('CONNECTING');

    mockClient.emit('connect');
    expect(diagnostics.listConnections()[0].state).toBe('ONLINE');

    mockClient.emit('reconnect');
    expect(diagnostics.listConnections()[0].state).toBe('RETRYING');
    expect(diagnostics.getMetrics().reconnects).toBe(1);

    mockClient.emit('error', new Error('connection refused'));
    expect(diagnostics.listConnections()[0].state).toBe('ERROR');

    mockClient.emit('offline');
    expect(diagnostics.listConnections()[0].state).toBe('OFFLINE');
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain('password');
  });

  it('records malformed messages without emitting them', async () => {
    const diagnostics = new DiagnosticHub();
    const adapter = new MqttIngressAdapter('mqtt://localhost', ['home/#'], diagnostics);
    const received = vi.fn();
    adapter.on('message', received);

    mockClient.emit('message', 'home/temp', Buffer.from('not-json'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).not.toHaveBeenCalled();
    expect(diagnostics.listEvents({ category: 'error' })[0]).toMatchObject({
      protocol: 'mqtt',
      type: 'protocol_error',
    });
  });
});
