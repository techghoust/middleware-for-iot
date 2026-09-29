import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeMessage } from '../types/bridge-message';
import { DiagnosticHub } from '../observability/diagnostics';
import { logger } from '../observability/logger';
import { DispatchTarget } from './dispatcher';

export interface DeadLetterRecord {
  failedAt: string;
  destination: string;
  attempts: number;
  error: string;
  message: BridgeMessage;
  replayAttempts?: number;
  lastReplayAt?: string;
  lastReplayError?: string;
}

export interface ReplaySummary {
  attempted: number;
  delivered: number;
  failed: number;
  malformed: number;
  pending: number;
}

export interface DeadLetterReplayOptions {
  intervalMs: number;
  batchSize: number;
}

interface ReplayResult {
  summary: ReplaySummary;
  deliveredMessages: BridgeMessage[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPayload(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isObject(value) || !isObject(value.source) || !isObject(value.meta)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.type === 'string' &&
    isPayload(value.payload) &&
    typeof value.source.adapter === 'string' &&
    typeof value.source.id === 'string' &&
    typeof value.meta.received_at === 'string' &&
    typeof value.meta.processing_ms === 'number' &&
    typeof value.meta.version === 'string'
  );
}

function parseRecord(line: string): DeadLetterRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (
      !isObject(value) ||
      typeof value.failedAt !== 'string' ||
      typeof value.destination !== 'string' ||
      typeof value.attempts !== 'number' ||
      typeof value.error !== 'string' ||
      !isBridgeMessage(value.message)
    ) {
      return undefined;
    }
    return value as unknown as DeadLetterRecord;
  } catch {
    return undefined;
  }
}

export class DeadLetterStore {
  private operations = Promise.resolve();

  constructor(readonly path: string) {
    if (!path.trim()) throw new Error('Dead-letter path is required');
  }

  append(record: DeadLetterRecord): Promise<void> {
    return this.run(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, JSON.stringify(record) + '\n', 'utf8');
    });
  }

  replay(target: DispatchTarget, batchSize: number): Promise<ReplayResult> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new Error('Replay batch size must be an integer between 1 and 1000');
    }
    return this.run(async () => {
      const content = await this.readText();
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      const retained: string[] = [];
      let attempted = 0;
      let delivered = 0;
      let failed = 0;
      let malformed = 0;
      const deliveredMessages: BridgeMessage[] = [];

      for (const line of lines) {
        const record = parseRecord(line);
        if (!record) {
          malformed += 1;
          retained.push(line);
          continue;
        }
        if (record.destination !== target.name || attempted >= batchSize) {
          retained.push(line);
          continue;
        }

        attempted += 1;
        try {
          await target.send(record.message);
          delivered += 1;
          deliveredMessages.push(record.message);
        } catch (error) {
          failed += 1;
          retained.push(
            JSON.stringify({
              ...record,
              replayAttempts: (record.replayAttempts ?? 0) + 1,
              lastReplayAt: new Date().toISOString(),
              lastReplayError: String(error),
            })
          );
        }
      }

      if (content || retained.length > 0) {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, retained.length > 0 ? retained.join('\n') + '\n' : '', 'utf8');
      }

      return {
        summary: {
          attempted,
          delivered,
          failed,
          malformed,
          pending: retained.length,
        },
        deliveredMessages,
      };
    });
  }

  private async readText(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operations.then(operation, operation);
    this.operations = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}

export class DeadLetterReplayer {
  private timer?: NodeJS.Timeout;
  private running?: Promise<ReplaySummary>;
  private stopped = true;

  constructor(
    private readonly store: DeadLetterStore,
    private readonly target: DispatchTarget,
    private readonly options: DeadLetterReplayOptions,
    private readonly diagnostics?: DiagnosticHub
  ) {
    if (
      !Number.isInteger(options.intervalMs) ||
      options.intervalMs < 100 ||
      options.intervalMs > 86400000
    ) {
      throw new Error('Replay interval must be an integer between 100 and 86400000');
    }
    if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) {
      throw new Error('Replay batch size must be an integer between 1 and 1000');
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info('DeadLetterReplay', 'Started', {
      path: this.store.path,
      intervalMs: this.options.intervalMs,
      batchSize: this.options.batchSize,
    });
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  runOnce(): Promise<ReplaySummary> {
    if (this.running) return this.running;
    const pending = this.store
      .replay(this.target, this.options.batchSize)
      .then((result) => {
        this.report(result);
        return result.summary;
      })
      .catch((error) => {
        logger.error('DeadLetterReplay', 'Replay cycle failed', { error: String(error) });
        this.diagnostics?.recordError(
          'webhook',
          'dead_letter_replay_failed',
          'dead-letter replay cycle failed',
          undefined,
          { error: String(error) }
        );
        throw error;
      })
      .finally(() => {
        if (this.running === pending) this.running = undefined;
      });
    this.running = pending;
    return pending;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          if (!this.stopped) this.schedule(this.options.intervalMs);
        });
    }, delayMs);
    this.timer.unref();
  }

  private report(result: ReplayResult): void {
    const { summary, deliveredMessages } = result;
    if (summary.malformed > 0) {
      logger.warn('DeadLetterReplay', 'Malformed records retained', {
        malformed: summary.malformed,
        path: this.store.path,
      });
    }
    if (summary.attempted === 0) return;
    logger.info('DeadLetterReplay', 'Replay cycle completed', summary);
    for (const message of deliveredMessages) {
      this.diagnostics?.recordMessage(
        'outgoing',
        'webhook',
        message.source.id,
        'dead-letter message replayed',
        { id: message.id, type: message.type, destination: this.target.name }
      );
    }
    if (summary.failed > 0) {
      this.diagnostics?.recordRetry('webhook', 'dead-letter messages remain pending', undefined, {
        ...summary,
      });
    }
  }
}
