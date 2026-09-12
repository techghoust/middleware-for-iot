import { setTimeout as delay } from 'node:timers/promises';

export type ConnectionState =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'ONLINE'
  | 'TIMEOUT'
  | 'ERROR'
  | 'RETRYING';
export type DiagnosticCategory =
  | 'connection'
  | 'message'
  | 'error'
  | 'retry'
  | 'sandbox'
  | 'system';
export type DiagnosticDirection = 'incoming' | 'outgoing' | 'internal';
export type DiagnosticProtocol = 'mqtt' | 'websocket' | 'http' | 'webhook' | 'system';

export interface StateTransition {
  from?: ConnectionState;
  to: ConnectionState;
  trigger: string;
  timestamp: string;
}

export interface ConnectionSnapshot {
  id: string;
  protocol: DiagnosticProtocol;
  state: ConnectionState;
  updatedAt: string;
  lastSeenAt: string;
  transitions: StateTransition[];
}

export interface DiagnosticEvent {
  id: number;
  timestamp: string;
  category: DiagnosticCategory;
  type: string;
  message: string;
  clientId?: string;
  direction?: DiagnosticDirection;
  protocol: DiagnosticProtocol;
  status?: string;
  details?: unknown;
}

export interface RuntimeMetrics {
  connectedDevices: number;
  activeConnections: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  reconnects: number;
  averageLatencyMs: number | null;
}

export interface SandboxSettings {
  enabled: boolean;
  latencyMs: number;
  lossRate: number;
  timeoutMs: number;
  interruptNext: boolean;
}

export interface SimulationResult {
  deliver: boolean;
  reason?: 'packet_loss' | 'connection_interruption';
}

export interface EventQuery {
  category?: DiagnosticCategory | 'all';
  search?: string;
  protocol?: DiagnosticProtocol;
  status?: string;
  clientId?: string;
  limit?: number;
}

export interface DiagnosticEventInput {
  category: DiagnosticCategory;
  type: string;
  message: string;
  clientId?: string;
  direction?: DiagnosticDirection;
  protocol: DiagnosticProtocol;
  status?: string;
  details?: unknown;
}

interface HubOptions {
  maxEvents?: number;
  maxTransitions?: number;
  maxConnections?: number;
  now?: () => Date;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_SANDBOX: SandboxSettings = {
  enabled: false,
  latencyMs: 0,
  lossRate: 0,
  timeoutMs: 0,
  interruptNext: false,
};

const SECRET_KEY = /(authorization|password|passwd|secret|token|api[-_]?key|cookie)/i;

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1, seen);
  }
  return output;
}

export function redactSensitive(value: unknown): unknown {
  return sanitize(value);
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

export class DiagnosticHub {
  private readonly events: DiagnosticEvent[] = [];
  private readonly connections = new Map<string, ConnectionSnapshot>();
  private readonly maxEvents: number;
  private readonly maxTransitions: number;
  private readonly maxConnections: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private nextEventId = 1;
  private messagesReceived = 0;
  private messagesSent = 0;
  private errors = 0;
  private reconnects = 0;
  private latencyTotalMs = 0;
  private latencySamples = 0;
  private sandbox: SandboxSettings = { ...DEFAULT_SANDBOX };

  constructor(options: HubOptions = {}) {
    this.maxEvents = integer(options.maxEvents ?? 500, 'maxEvents', 10, 10000);
    this.maxTransitions = integer(options.maxTransitions ?? 20, 'maxTransitions', 1, 100);
    this.maxConnections = integer(options.maxConnections ?? 1000, 'maxConnections', 1, 10000);
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  }

  record(input: DiagnosticEventInput): DiagnosticEvent {
    const event: DiagnosticEvent = {
      ...input,
      id: this.nextEventId++,
      timestamp: this.now().toISOString(),
      details: input.details === undefined ? undefined : sanitize(input.details),
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents)
      this.events.splice(0, this.events.length - this.maxEvents);
    return { ...event };
  }

  transition(
    id: string,
    protocol: DiagnosticProtocol,
    state: ConnectionState,
    trigger: string,
    details?: unknown
  ): ConnectionSnapshot {
    const timestamp = this.now().toISOString();
    const current = this.connections.get(id);
    const transition: StateTransition = { from: current?.state, to: state, trigger, timestamp };
    const transitions = [...(current?.transitions ?? []), transition].slice(-this.maxTransitions);
    const connection: ConnectionSnapshot = {
      id,
      protocol,
      state,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
      transitions,
    };
    this.connections.set(id, connection);
    this.pruneInactiveConnections();
    if (state === 'RETRYING' && current?.state !== 'RETRYING') this.reconnects += 1;
    const eventType =
      state === 'ONLINE' && current?.state === 'RETRYING'
        ? 'connection_restored'
        : state === 'ONLINE'
          ? 'connection_opened'
          : state === 'OFFLINE'
            ? 'connection_closed'
            : state === 'TIMEOUT'
              ? 'connection_timeout'
              : state === 'RETRYING'
                ? 'connection_retrying'
                : state === 'ERROR'
                  ? 'connection_error'
                  : 'connection_connecting';
    this.record({
      category: state === 'ERROR' ? 'error' : state === 'RETRYING' ? 'retry' : 'connection',
      type: eventType,
      message: `${current?.state ?? 'UNKNOWN'} -> ${state}: ${trigger}`,
      clientId: id,
      direction: 'internal',
      protocol,
      status: state,
      details,
    });
    if (state === 'ERROR') this.errors += 1;
    return this.copyConnection(connection);
  }

  touch(id: string): void {
    const connection = this.connections.get(id);
    if (connection) connection.lastSeenAt = this.now().toISOString();
  }

  recordMessage(
    direction: 'incoming' | 'outgoing',
    protocol: DiagnosticProtocol,
    clientId: string,
    message: string,
    details?: unknown,
    latencyMs?: number
  ): DiagnosticEvent {
    if (direction === 'incoming') this.messagesReceived += 1;
    else this.messagesSent += 1;
    if (latencyMs !== undefined && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.latencyTotalMs += latencyMs;
      this.latencySamples += 1;
    }
    this.touch(clientId);
    return this.record({
      category: 'message',
      type: direction === 'incoming' ? 'message_received' : 'message_sent',
      message,
      clientId,
      direction,
      protocol,
      status: 'ok',
      details,
    });
  }

  recordError(
    protocol: DiagnosticProtocol,
    type: string,
    message: string,
    clientId?: string,
    details?: unknown
  ): DiagnosticEvent {
    this.errors += 1;
    return this.record({
      category: 'error',
      type,
      message,
      clientId,
      direction: 'internal',
      protocol,
      status: 'error',
      details,
    });
  }

  recordRetry(
    protocol: DiagnosticProtocol,
    message: string,
    clientId?: string,
    details?: unknown
  ): DiagnosticEvent {
    return this.record({
      category: 'retry',
      type: 'delivery_retry',
      message,
      clientId,
      direction: 'outgoing',
      protocol,
      status: 'retrying',
      details,
    });
  }

  listEvents(query: EventQuery = {}): DiagnosticEvent[] {
    const search = query.search?.trim().toLowerCase();
    const limit = Math.min(Math.max(query.limit ?? 100, 1), this.maxEvents);
    return this.events
      .filter(
        (event) => !query.category || query.category === 'all' || event.category === query.category
      )
      .filter((event) => !query.protocol || event.protocol === query.protocol)
      .filter((event) => !query.status || event.status === query.status)
      .filter((event) => !query.clientId || event.clientId === query.clientId)
      .filter((event) => {
        if (!search) return true;
        return JSON.stringify(event).toLowerCase().includes(search);
      })
      .slice(-limit)
      .reverse()
      .map((event) => ({ ...event }));
  }

  listConnections(): ConnectionSnapshot[] {
    return [...this.connections.values()]
      .map((connection) => this.copyConnection(connection))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getMetrics(): RuntimeMetrics {
    const current = [...this.connections.values()];
    return {
      connectedDevices: current.filter(
        (connection) => connection.protocol === 'websocket' && connection.state === 'ONLINE'
      ).length,
      activeConnections: current.filter((connection) => connection.state === 'ONLINE').length,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
      errors: this.errors,
      reconnects: this.reconnects,
      averageLatencyMs:
        this.latencySamples === 0
          ? null
          : Math.round((this.latencyTotalMs / this.latencySamples) * 100) / 100,
    };
  }

  getSandbox(): SandboxSettings {
    return { ...this.sandbox };
  }

  configureSandbox(settings: Partial<SandboxSettings>): SandboxSettings {
    const next: SandboxSettings = {
      enabled: settings.enabled ?? this.sandbox.enabled,
      latencyMs: integer(settings.latencyMs ?? this.sandbox.latencyMs, 'latencyMs', 0, 60000),
      lossRate: Number(settings.lossRate ?? this.sandbox.lossRate),
      timeoutMs: integer(settings.timeoutMs ?? this.sandbox.timeoutMs, 'timeoutMs', 0, 60000),
      interruptNext: settings.interruptNext ?? this.sandbox.interruptNext,
    };
    if (typeof next.enabled !== 'boolean' || typeof next.interruptNext !== 'boolean') {
      throw new Error('enabled and interruptNext must be boolean');
    }
    if (!Number.isFinite(next.lossRate) || next.lossRate < 0 || next.lossRate > 1) {
      throw new Error('lossRate must be between 0 and 1');
    }
    this.sandbox = next;
    this.record({
      category: 'sandbox',
      type: 'sandbox_configured',
      message: next.enabled ? 'simulation enabled' : 'simulation disabled',
      direction: 'internal',
      protocol: 'system',
      status: next.enabled ? 'active' : 'disabled',
      details: next,
    });
    return this.getSandbox();
  }

  resetSandbox(): SandboxSettings {
    this.sandbox = { ...DEFAULT_SANDBOX };
    this.record({
      category: 'sandbox',
      type: 'sandbox_reset',
      message: 'simulation disabled and reset',
      direction: 'internal',
      protocol: 'system',
      status: 'disabled',
      details: this.sandbox,
    });
    return this.getSandbox();
  }

  async simulate(clientId: string, protocol: DiagnosticProtocol): Promise<SimulationResult> {
    const settings = this.getSandbox();
    if (!settings.enabled) return { deliver: true };

    if (settings.interruptNext) {
      this.sandbox.interruptNext = false;
      this.transition(clientId, protocol, 'OFFLINE', 'simulated connection interruption');
      this.transition(clientId, protocol, 'RETRYING', 'simulated reconnect started');
      if (settings.latencyMs > 0) await this.sleep(settings.latencyMs);
      this.transition(clientId, protocol, 'ONLINE', 'simulated connection restored');
      return { deliver: false, reason: 'connection_interruption' };
    }

    if (settings.lossRate > 0 && this.random() < settings.lossRate) {
      this.record({
        category: 'sandbox',
        type: 'message_dropped',
        message: 'message dropped by packet loss simulation',
        clientId,
        direction: 'incoming',
        protocol,
        status: 'dropped',
        details: { lossRate: settings.lossRate },
      });
      return { deliver: false, reason: 'packet_loss' };
    }

    if (settings.latencyMs > 0) {
      this.record({
        category: 'sandbox',
        type: 'latency_applied',
        message: `applied ${settings.latencyMs} ms latency`,
        clientId,
        direction: 'incoming',
        protocol,
        status: 'delayed',
        details: { latencyMs: settings.latencyMs, timeoutMs: settings.timeoutMs },
      });
      if (settings.timeoutMs > 0 && settings.latencyMs >= settings.timeoutMs) {
        await this.sleep(settings.timeoutMs);
        this.transition(clientId, protocol, 'TIMEOUT', 'simulated latency exceeded timeout');
        this.transition(clientId, protocol, 'RETRYING', 'simulated timeout retry');
        await this.sleep(settings.latencyMs - settings.timeoutMs);
        this.transition(clientId, protocol, 'ONLINE', 'simulated retry completed');
      } else {
        await this.sleep(settings.latencyMs);
      }
    }

    return { deliver: true };
  }

  snapshot(query: EventQuery = {}) {
    return {
      generatedAt: this.now().toISOString(),
      sandbox: this.getSandbox(),
      metrics: this.getMetrics(),
      connections: this.listConnections(),
      events: this.listEvents(query),
    };
  }

  private copyConnection(connection: ConnectionSnapshot): ConnectionSnapshot {
    return {
      ...connection,
      transitions: connection.transitions.map((transition) => ({ ...transition })),
    };
  }

  private pruneInactiveConnections(): void {
    while (this.connections.size > this.maxConnections) {
      const oldestInactive = [...this.connections.values()]
        .filter((connection) => connection.state !== 'ONLINE')
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];
      if (!oldestInactive) return;
      this.connections.delete(oldestInactive.id);
    }
  }
}
