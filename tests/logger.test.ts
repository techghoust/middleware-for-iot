import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../src/observability/logger';

describe('Logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs info message to console', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    logger.info('TestModule', 'Hello world');

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
    expect(output).toContain('[TestModule]');
    expect(output).toContain('Hello world');
  });

  it('logs error message to console', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    logger.error('TestModule', 'Something went wrong', { code: 500 });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[ERROR]');
    expect(output).toContain('Something went wrong');
  });

  it('logs warn message to console', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    logger.warn('TestModule', 'Be careful');

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[WARN]');
    expect(output).toContain('Be careful');
  });

  it('includes data in log output', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    logger.info('TestModule', 'With data', { value: 42 });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('42');
  });
});
