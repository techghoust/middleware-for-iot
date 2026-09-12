import { describe, expect, it, vi } from 'vitest';
import { DiagnosticHub } from '../src/observability/diagnostics';

describe('DiagnosticHub', () => {
  it('tracks connection state and keeps bounded transition history', () => {
    const hub = new DiagnosticHub({ maxTransitions: 2 });
    hub.transition('device-1', 'websocket', 'ONLINE', 'opened');
    hub.transition('device-1', 'websocket', 'TIMEOUT', 'heartbeat expired');
    hub.transition('device-1', 'websocket', 'RETRYING', 'reconnect');
    hub.transition('device-1', 'websocket', 'ONLINE', 'restored');

    const connection = hub.listConnections()[0];
    expect(connection.state).toBe('ONLINE');
    expect(connection.transitions).toHaveLength(2);
    expect(connection.transitions.map((transition) => transition.to)).toEqual([
      'RETRYING',
      'ONLINE',
    ]);
    expect(hub.getMetrics().reconnects).toBe(1);
  });

  it('bounds event history and supports category and text filters', () => {
    const hub = new DiagnosticHub({ maxEvents: 10 });
    for (let index = 0; index < 12; index++) {
      hub.record({
        category: index % 2 ? 'message' : 'connection',
        type: 'sample',
        message: `event ${index}`,
        protocol: 'system',
      });
    }

    expect(hub.listEvents({ limit: 100 })).toHaveLength(10);
    expect(hub.listEvents({ category: 'connection' })).toHaveLength(5);
    expect(hub.listEvents({ search: 'event 11' })).toHaveLength(1);
    expect(hub.listEvents({ limit: 1 })[0].message).toBe('event 11');
  });

  it('bounds inactive connections without removing active connections', () => {
    const hub = new DiagnosticHub({ maxConnections: 2 });
    hub.transition('active-1', 'websocket', 'ONLINE', 'opened');
    hub.transition('active-2', 'websocket', 'ONLINE', 'opened');
    hub.transition('old-offline', 'websocket', 'OFFLINE', 'closed');

    expect(
      hub
        .listConnections()
        .map((connection) => connection.id)
        .sort()
    ).toEqual(['active-1', 'active-2']);
  });

  it('derives metrics only from observed messages and connections', () => {
    const hub = new DiagnosticHub();
    hub.transition('device-1', 'websocket', 'ONLINE', 'opened');
    hub.transition('mqtt:broker', 'mqtt', 'ONLINE', 'connected');
    hub.recordMessage('incoming', 'websocket', 'device-1', 'received', {}, 30);
    hub.recordMessage('outgoing', 'webhook', 'device-1', 'sent', {}, 10);
    hub.recordError('websocket', 'protocol_error', 'invalid payload', 'device-1');

    expect(hub.getMetrics()).toEqual({
      connectedDevices: 1,
      activeConnections: 2,
      messagesReceived: 1,
      messagesSent: 1,
      errors: 1,
      reconnects: 0,
      averageLatencyMs: 20,
    });
  });

  it('redacts secrets and handles circular diagnostic details', () => {
    const hub = new DiagnosticHub();
    const details: Record<string, unknown> = {
      token: 'private',
      nested: { authorization: 'Bearer private', value: 42 },
    };
    details.self = details;
    hub.record({
      category: 'system',
      type: 'safe',
      message: 'safe event',
      protocol: 'system',
      details,
    });

    expect(hub.listEvents()[0].details).toEqual({
      token: '[redacted]',
      nested: { authorization: '[redacted]', value: 42 },
      self: '[circular]',
    });
  });

  it('does nothing while simulation is disabled', async () => {
    const sleep = vi.fn(async () => undefined);
    const hub = new DiagnosticHub({ sleep });
    expect(await hub.simulate('device-1', 'websocket')).toEqual({ deliver: true });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('simulates latency, timeout, retry and recovery through connection state', async () => {
    const sleep = vi.fn(async () => undefined);
    const hub = new DiagnosticHub({ sleep });
    hub.transition('device-1', 'websocket', 'ONLINE', 'opened');
    hub.configureSandbox({
      enabled: true,
      latencyMs: 1500,
      timeoutMs: 1000,
      lossRate: 0,
      interruptNext: false,
    });

    expect(await hub.simulate('device-1', 'websocket')).toEqual({ deliver: true });
    expect(sleep.mock.calls).toEqual([[1000], [500]]);
    expect(
      hub
        .listConnections()[0]
        .transitions.slice(-3)
        .map((item) => item.to)
    ).toEqual(['TIMEOUT', 'RETRYING', 'ONLINE']);
    expect(hub.getMetrics().reconnects).toBe(1);
  });

  it('simulates packet loss and one-shot interruption, then resets safely', async () => {
    const hub = new DiagnosticHub({ random: () => 0 });
    hub.transition('device-1', 'websocket', 'ONLINE', 'opened');
    hub.configureSandbox({ enabled: true, lossRate: 1 });
    expect(await hub.simulate('device-1', 'websocket')).toEqual({
      deliver: false,
      reason: 'packet_loss',
    });

    hub.configureSandbox({ lossRate: 0, interruptNext: true });
    expect(await hub.simulate('device-1', 'websocket')).toEqual({
      deliver: false,
      reason: 'connection_interruption',
    });
    expect(hub.getSandbox().interruptNext).toBe(false);
    expect(hub.listConnections()[0].state).toBe('ONLINE');

    expect(hub.resetSandbox()).toEqual({
      enabled: false,
      latencyMs: 0,
      lossRate: 0,
      timeoutMs: 0,
      interruptNext: false,
    });
  });

  it('rejects unsafe simulation settings', () => {
    const hub = new DiagnosticHub();
    expect(() => hub.configureSandbox({ lossRate: 1.1 })).toThrow('lossRate');
    expect(() => hub.configureSandbox({ latencyMs: -1 })).toThrow('latencyMs');
    expect(() => hub.configureSandbox({ timeoutMs: 70000 })).toThrow('timeoutMs');
  });
});
