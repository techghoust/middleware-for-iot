import { BridgeMessage } from '../types/bridge-message';
import { randomUUID } from 'crypto';
import { logger } from '../observability/logger';

export function normalize(adapter: string, topic: string, rawData: unknown): BridgeMessage {
  const receivedAt = new Date().toISOString();

  if (typeof rawData !== 'object' || rawData === null) {
    logger.error('Normalizer', `Invalid data from ${adapter}`, { topic, rawData });
    throw new Error(`Invalid data from ${adapter}: expected an object`);
  }

  const message: BridgeMessage = {
    id: randomUUID(),
    source: {
      adapter: adapter,
      id: topic,
      topic: topic,
    },
    timestamp: receivedAt,
    type: topicToType(topic),
    payload: rawData as Record<string, unknown>,
    meta: {
      received_at: receivedAt,
      processing_ms: 0,
      version: '1.0',
    },
  };

  logger.debug('Normalizer', `Normalized message`, { type: message.type, adapter });
  return message;
}

function topicToType(topic: string): string {
  const parts = topic.split('/');
  const last = parts[parts.length - 1];
  return `telemetry.${last}`;
}
