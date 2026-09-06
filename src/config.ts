import { config } from 'dotenv';

config();

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
  return value;
}

const webhookUrl = process.env.WEBHOOK_URL?.trim();
if (webhookUrl && !['http:', 'https:'].includes(new URL(webhookUrl).protocol)) {
  throw new Error('WEBHOOK_URL must use HTTP or HTTPS');
}

export const CONFIG = {
  webhook: {
    url: webhookUrl,
    timeoutMs: integer('WEBHOOK_TIMEOUT_MS', 5000, 1, 300000),
    attempts: integer('WEBHOOK_ATTEMPTS', 3, 1, 10),
    retryDelayMs: integer('WEBHOOK_RETRY_DELAY_MS', 500, 0, 60000),
    deadLetterPath: process.env.DEAD_LETTER_PATH || 'data/dead-letters.jsonl',
  },
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    topics: (process.env.MQTT_TOPICS || 'home/#').split(','),
  },
  http: {
    port: parseInt(process.env.HTTP_PORT || '3000', 10),
  },
  websocket: {
    port: parseInt(process.env.WEBSOCKET_PORT || '3002', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
