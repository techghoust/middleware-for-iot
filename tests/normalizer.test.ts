import { describe, it, expect } from 'vitest';
import { normalize } from '../src/core/normalizer';

describe('normalizer', () => {
  it('converts raw data to BridgeMessage', () => {
    const result = normalize('mqtt', 'home/room42/temperature', { value: 23.4, unit: 'celsius' });

    expect(result.type).toBe('telemetry.temperature');
    expect(result.source.adapter).toBe('mqtt');
    expect(result.payload).toEqual({ value: 23.4, unit: 'celsius' });
    expect(result.id).toBeDefined();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws error on invalid data', () => {
    expect(() => normalize('mqtt', 'home/temp', 'not-an-object')).toThrow('Invalid data from mqtt');
  });
});
