import { BridgeMessage } from '../types/bridge-message';
import { DispatchTarget } from '../core/dispatcher';

export function createWebhookTarget(name: string, url: string): DispatchTarget {
  return {
    name,
    send: async (msg: BridgeMessage) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });

      if (!response.ok) {
        throw new Error(`[Webhook] Failed to send to ${url}: ${response.status}`);
      }

      console.log(`[Webhook] Sent to ${url}: ${msg.type}`);
    },
  };
}
