import { config } from 'dotenv';

config();

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
  return value;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid ${name}: expected true or false`);
}

function ratio(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${name}: expected a number between 0 and 1`);
  }
  return value;
}

const webhookUrl = process.env.WEBHOOK_URL?.trim();
if (webhookUrl && !['http:', 'https:'].includes(new URL(webhookUrl).protocol)) {
  throw new Error('WEBHOOK_URL must use HTTP or HTTPS');
}

export const CONFIG = {
  diagnostics: {
    enabled: flag('DIAGNOSTICS_ENABLED', process.env.NODE_ENV !== 'production'),
    maxEvents: integer('DIAGNOSTICS_MAX_EVENTS', 500, 10, 10000),
    maxConnections: integer('DIAGNOSTICS_MAX_CONNECTIONS', 1000, 1, 10000),
    sandbox: {
      enabled: flag('SANDBOX_ENABLED', false),
      latencyMs: integer('SANDBOX_LATENCY_MS', 0, 0, 60000),
      lossRate: ratio('SANDBOX_LOSS_RATE', 0),
      timeoutMs: integer('SANDBOX_TIMEOUT_MS', 0, 0, 60000),
      interruptNext: false,
    },
  },
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
    port: integer('HTTP_PORT', 3000, 1, 65535),
  },
  websocket: {
    port: integer('WEBSOCKET_PORT', 3002, 1, 65535),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
