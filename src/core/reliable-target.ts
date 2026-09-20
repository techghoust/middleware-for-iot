import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DispatchTarget } from './dispatcher';
import { logger } from '../observability/logger';
import { DiagnosticHub } from '../observability/diagnostics';

export interface DeliveryOptions {
  attempts: number;
  retryDelayMs: number;
  deadLetterPath: string;
}

export function reliableTarget(
  target: DispatchTarget,
  options: DeliveryOptions,
  diagnostics?: DiagnosticHub
): DispatchTarget {
  if (
    !Number.isInteger(options.attempts) ||
    options.attempts < 1 ||
    options.attempts > 10 ||
    !Number.isInteger(options.retryDelayMs) ||
    options.retryDelayMs < 0 ||
    options.retryDelayMs > 60000 ||
    !options.deadLetterPath.trim()
  )
    throw new Error('Invalid delivery options');
  let writes = Promise.resolve();
  return {
    name: target.name,
    async send(message) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= options.attempts; attempt++) {
        try {
          await target.send(message);
          return;
        } catch (error) {
          lastError = error;
          logger.warn('Delivery', 'Attempt failed', {
            id: message.id,
            target: target.name,
            attempt,
            error: String(error),
          });
          if (attempt < options.attempts) {
            diagnostics?.recordRetry(
              target.name === 'webhook' ? 'webhook' : 'system',
              `delivery attempt ${attempt} failed; retry scheduled`,
              message.source.id,
              { target: target.name, attempt, id: message.id, error: String(error) }
            );
          }
          if (attempt < options.attempts)
            await delay(Math.min(options.retryDelayMs * 2 ** (attempt - 1), 60000));
        }
      }
      const record =
        JSON.stringify({
          failedAt: new Date().toISOString(),
          destination: target.name,
          attempts: options.attempts,
          error: String(lastError),
          message,
        }) + '\n';
      const pending = writes.then(async () => {
        await mkdir(dirname(options.deadLetterPath), { recursive: true });
        await appendFile(options.deadLetterPath, record, 'utf8');
      });
      writes = pending.catch(() => undefined);
      try {
        await pending;
      } catch (error) {
        throw new Error('Delivery AND dead-letter persistence failed: ' + String(error));
      }
      throw new Error(
        'Delivery failed; saved to ' + options.deadLetterPath + ': ' + String(lastError)
      );
    },
  };
}
