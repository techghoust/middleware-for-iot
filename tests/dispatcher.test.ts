import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../src/core/dispatcher';
import { BridgeMessage } from '../src/types/bridge-message';
import { logger } from '../src/observability/logger';

const mockMessage = (): BridgeMessage => ({
  id: 'test-id',
  source: { adapter: 'mqtt', id: 'sensor-1', topic: 'home/temp' },
  timestamp: '2026-06-01T00:00:00Z',
  type: 'telemetry.temperature',
  payload: { value: 23.4 },
  meta: { received_at: '2026-06-01T00:00:00Z', processing_ms: 0, version: '1.0' },
});

describe('Dispatcher', () => {
  it('sends message to registered target', async () => {
    const dispatcher = new Dispatcher();
    const mockSend = vi.fn().mockResolvedValue(undefined);

    dispatcher.register({ name: 'webhook', send: mockSend });
    await dispatcher.dispatch(mockMessage(), ['webhook']);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(mockMessage());
  });

  it('warns when destination is not registered', async () => {
    const dispatcher = new Dispatcher();
    const warn = vi.spyOn(logger, 'warn');

    await dispatcher.dispatch(mockMessage(), ['unknown-target']);

    expect(warn).toHaveBeenCalledWith('Dispatcher', 'Unknown destination: unknown-target');
  });

  it('sends to multiple destinations', async () => {
    const dispatcher = new Dispatcher();
    const mockSend1 = vi.fn().mockResolvedValue(undefined);
    const mockSend2 = vi.fn().mockResolvedValue(undefined);

    dispatcher.register({ name: 'webhook', send: mockSend1 });
    dispatcher.register({ name: 'database', send: mockSend2 });

    await dispatcher.dispatch(mockMessage(), ['webhook', 'database']);

    expect(mockSend1).toHaveBeenCalledTimes(1);
    expect(mockSend2).toHaveBeenCalledTimes(1);
  });
});
