import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';

export interface DispatchTarget {
  name: string;
  send: (msg: BridgeMessage) => Promise<void>;
}

export class Dispatcher {
  private targets: Map<string, DispatchTarget>;

  constructor() {
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
        return;
      }

      try {
        await target.send(msg);
        logger.info('Dispatcher', `Sent to ${name}`, { type: msg.type, id: msg.id });
      } catch (error) {
        logger.error('Dispatcher', `Failed to send to ${name}`, {
          error: String(error),
          id: msg.id,
        });
      }
    });

    await Promise.all(promises);
  }
}
