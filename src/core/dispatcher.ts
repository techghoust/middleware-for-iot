import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';
import { DiagnosticHub, DiagnosticProtocol } from '../observability/diagnostics';

export interface DispatchTarget {
  name: string;
  send: (msg: BridgeMessage) => Promise<void>;
}

export class Dispatcher {
  private targets: Map<string, DispatchTarget>;

  constructor(private readonly diagnostics?: DiagnosticHub) {
    this.targets = new Map();
  }

  register(target: DispatchTarget): void {
    this.targets.set(target.name, target);
    logger.info('Dispatcher', `Registered target: ${target.name}`);
  }

  async dispatch(msg: BridgeMessage, destinations: string[]): Promise<void> {
    const promises = destinations.map(async (name) => {
      const target = this.targets.get(name);

      if (!target) {
        logger.warn('Dispatcher', `Unknown destination: ${name}`);
        this.diagnostics?.recordError(
          'system',
          'unknown_destination',
          `unknown destination: ${name}`,
          msg.source.id,
          { destination: name, id: msg.id, type: msg.type }
        );
        return;
      }

      try {
        const startedAt = performance.now();
        await target.send(msg);
        const latencyMs = performance.now() - startedAt;
        logger.info('Dispatcher', `Sent to ${name}`, { type: msg.type, id: msg.id });
        const protocol: DiagnosticProtocol = name === 'webhook' ? 'webhook' : 'system';
        this.diagnostics?.recordMessage(
          'outgoing',
          protocol,
          msg.source.id,
          `sent to ${name}`,
          {
            destination: name,
            id: msg.id,
            type: msg.type,
            test: msg.meta.test,
          },
          latencyMs
        );
      } catch (error) {
        logger.error('Dispatcher', `Failed to send to ${name}`, {
          error: String(error),
          id: msg.id,
        });
        this.diagnostics?.recordError(
          name === 'webhook' ? 'webhook' : 'system',
          'delivery_failed',
          `failed to send to ${name}`,
          msg.source.id,
          { destination: name, id: msg.id, type: msg.type, error: String(error) }
        );
      }
    });

    await Promise.all(promises);
  }
}
