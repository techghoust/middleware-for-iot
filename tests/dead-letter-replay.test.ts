import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeadLetterRecord,
  DeadLetterReplayer,
  DeadLetterStore,
} from '../src/core/dead-letter-replay';
import { normalize } from '../src/core/normalizer';
import { DiagnosticHub } from '../src/observability/diagnostics';

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'databridge-replay-'));
  directories.push(directory);
  return new DeadLetterStore(join(directory, 'dead.jsonl'));
}

function record(id: string): DeadLetterRecord {
  const message = normalize('mqtt', `home/${id}/temperature`, { value: 23.4 });
  message.id = id;
  return {
    failedAt: '2026-09-24T00:00:00.000Z',
    destination: 'webhook',
    attempts: 3,
    error: 'Error: offline',
    message,
  };
}

async function lines(store: DeadLetterStore): Promise<string[]> {
  return (await readFile(store.path, 'utf8')).split(/\r?\n/).filter(Boolean);
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('DeadLetterReplayer', () => {
  it('delivers queued messages and removes successful records', async () => {
    const store = await fixture();
    await store.append(record('one'));
    await store.append(record('two'));
    const send = vi.fn().mockResolvedValue(undefined);
    const diagnostics = new DiagnosticHub();
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send },
      {
        intervalMs: 100,
        batchSize: 10,
      },
      diagnostics
    );

    await expect(replayer.runOnce()).resolves.toEqual({
      attempted: 2,
      delivered: 2,
      failed: 0,
      malformed: 0,
      pending: 0,
    });
    expect(send.mock.calls.map(([message]) => message.id)).toEqual(['one', 'two']);
    expect(await readFile(store.path, 'utf8')).toBe('');
    expect(diagnostics.snapshot().metrics.messagesSent).toBe(2);
  });

  it('replays array payloads accepted by the normalizer', async () => {
    const store = await fixture();
    const queued = record('array');
    queued.message.payload = [1, 2, 3] as unknown as Record<string, unknown>;
    await store.append(queued);
    const send = vi.fn().mockResolvedValue(undefined);
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send },
      {
        intervalMs: 100,
        batchSize: 10,
      }
    );

    await replayer.runOnce();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ payload: [1, 2, 3] }));
  });

  it('runs automatically after start', async () => {
    vi.useFakeTimers();
    const store = await fixture();
    await store.append(record('scheduled'));
    const send = vi.fn().mockResolvedValue(undefined);
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send },
      {
        intervalMs: 100,
        batchSize: 10,
      }
    );

    replayer.start();
    await vi.advanceTimersByTimeAsync(0);
    await replayer.stop();

    expect(send).toHaveBeenCalledOnce();
    expect(await readFile(store.path, 'utf8')).toBe('');
  });

  it('retains failed records with replay metadata', async () => {
    const store = await fixture();
    await store.append(record('one'));
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send: vi.fn().mockRejectedValue(new Error('still offline')) },
      { intervalMs: 100, batchSize: 10 }
    );

    const summary = await replayer.runOnce();
    const retained = JSON.parse((await lines(store))[0]);

    expect(summary).toMatchObject({ attempted: 1, delivered: 0, failed: 1, pending: 1 });
    expect(retained).toMatchObject({
      replayAttempts: 1,
      lastReplayError: 'Error: still offline',
      message: { id: 'one' },
    });
    expect(retained.lastReplayAt).toEqual(expect.any(String));
  });

  it('processes only the configured batch and preserves ordering', async () => {
    const store = await fixture();
    await Promise.all(['one', 'two', 'three'].map((id) => store.append(record(id))));
    const send = vi.fn().mockResolvedValue(undefined);
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send },
      {
        intervalMs: 100,
        batchSize: 2,
      }
    );

    await expect(replayer.runOnce()).resolves.toMatchObject({
      attempted: 2,
      delivered: 2,
      pending: 1,
    });
    expect(JSON.parse((await lines(store))[0]).message.id).toBe('three');
  });

  it('retains malformed and unrelated records', async () => {
    const store = await fixture();
    const unrelated = { ...record('console'), destination: 'console' };
    await writeFile(store.path, `not-json\n${JSON.stringify(unrelated)}\n`, 'utf8');
    const send = vi.fn();
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send },
      {
        intervalMs: 100,
        batchSize: 10,
      }
    );

    await expect(replayer.runOnce()).resolves.toEqual({
      attempted: 0,
      delivered: 0,
      failed: 0,
      malformed: 1,
      pending: 2,
    });
    expect(send).not.toHaveBeenCalled();
    expect(await lines(store)).toHaveLength(2);
  });

  it('does not lose records appended during replay', async () => {
    const store = await fixture();
    await store.append(record('old'));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replayer = new DeadLetterReplayer(
      store,
      { name: 'webhook', send: () => blocked },
      { intervalMs: 100, batchSize: 10 }
    );

    const replay = replayer.runOnce();
    const append = store.append(record('new'));
    release();
    await replay;
    await append;

    expect(JSON.parse((await lines(store))[0]).message.id).toBe('new');
  });
});
