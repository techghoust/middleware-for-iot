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
});
