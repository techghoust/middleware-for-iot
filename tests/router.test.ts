import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../src/core/router';
import { BridgeMessage } from '../src/types/bridge-message';

const mockMessage = (type: string): BridgeMessage => ({
  id: 'test-id',
  source: { adapter: 'mqtt', id: 'sensor-1', topic: 'home/temp' },
  timestamp: '2026-06-01T00:00:00Z',
  type,
  payload: { value: 23.4 },
  meta: { received_at: '2026-06-01T00:00:00Z', processing_ms: 0, version: '1.0' },
});

describe('MessageRouter', () => {
  it('routes message to correct destination', () => {
    const router = new MessageRouter([
      {
        name: 'temp-rule',
        match: { type: 'telemetry.temperature' },
        destinations: ['webhook'],
      },
    ]);

    const result = router.route(mockMessage('telemetry.temperature'));
    expect(result).toEqual(['webhook']);
  });

  it('supports wildcard matching', () => {
    const router = new MessageRouter([
      {
        name: 'all-telemetry',
        match: { type: 'telemetry.*' },
        destinations: ['database'],
      },
    ]);

    const result = router.route(mockMessage('telemetry.humidity'));
    expect(result).toEqual(['database']);
  });

  it('returns empty array when no rules match', () => {
    const router = new MessageRouter([
      {
        name: 'temp-rule',
        match: { type: 'telemetry.temperature' },
        destinations: ['webhook'],
      },
    ]);

    const result = router.route(mockMessage('telemetry.humidity'));
    expect(result).toEqual([]);
  });

  it('removes duplicate destinations', () => {
    const router = new MessageRouter([
      { name: 'rule-1', match: { type: 'telemetry.*' }, destinations: ['webhook'] },
      { name: 'rule-2', match: { type: 'telemetry.temperature' }, destinations: ['webhook'] },
    ]);

    const result = router.route(mockMessage('telemetry.temperature'));
    expect(result).toEqual(['webhook']);
  });
});
