import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

const LOG_DIR = 'logs';
const LOG_FILE = join(LOG_DIR, 'databridge.log');
const ERROR_FILE = join(LOG_DIR, 'errors.log');

mkdirSync(LOG_DIR, { recursive: true });

const COLORS = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

function formatEntry(entry: LogEntry): string {
  const data = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${data}`;
}

function writeToFile(file: string, line: string): void {
  try {
    appendFileSync(file, line + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
  };

  const formatted = formatEntry(entry);
  const color = COLORS[level];

  console.log(`${color}${formatted}${COLORS.reset}`);

  writeToFile(LOG_FILE, formatted);

  if (level === 'error') {
    writeToFile(ERROR_FILE, formatted);
  }
}

export const logger = {
  debug: (module: string, message: string, data?: unknown) => log('debug', module, message, data),
  info: (module: string, message: string, data?: unknown) => log('info', module, message, data),
  warn: (module: string, message: string, data?: unknown) => log('warn', module, message, data),
  error: (module: string, message: string, data?: unknown) => log('error', module, message, data),
};
