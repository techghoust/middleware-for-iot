import { describe, it, expect, vi } from 'vitest';
import { createWebhookTarget } from '../src/adapters/webhook-egress';
import { BridgeMessage } from '../src/types/bridge-message';

const mockMessage = (): BridgeMessage => ({
  id: 'test-id',
  source: { adapter: 'http', id: 'temperature', topic: 'temperature' },
  timestamp: '2026-06-01T00:00:00Z',
  type: 'telemetry.temperature',
  payload: { value: 23.4 },
  meta: { received_at: '2026-06-01T00:00:00Z', processing_ms: 0, version: '1.0' },
});

describe('WebhookEgressAdapter', () => {
  it('sends message to webhook url', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const target = createWebhookTarget('test-webhook', 'https://example.com/hook');
    await target.send(mockMessage());

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('throws error when webhook returns error status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', mockFetch);

    const target = createWebhookTarget('test-webhook', 'https://example.com/hook');

    await expect(target.send(mockMessage())).rejects.toThrow(
      'Failed to send to https://example.com/hook: 500'
    );
  });
});
