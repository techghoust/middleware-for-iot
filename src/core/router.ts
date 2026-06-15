import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';

export interface RouteRule {
  name: string;
  match: {
    type: string;
    filter?: string;
  };
  destinations: string[];
}

export class MessageRouter {
  private rules: RouteRule[];

  constructor(rules: RouteRule[]) {
    this.rules = rules;
    logger.info('Router', `Loaded ${rules.length} routing rules`);
  }

  route(msg: BridgeMessage): string[] {
    const destinations: string[] = [];

    for (const rule of this.rules) {
      if (this.matchesType(rule.match.type, msg.type)) {
        destinations.push(...rule.destinations);
      }
    }

    logger.debug('Router', `Routing message`, { type: msg.type, destinations });
    return [...new Set(destinations)];
  }
  private matchesType(pattern: string, type: string): boolean {
    if (pattern === '*') return true;

    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return type.startsWith(prefix);
    }

    return pattern === type;
  }
}
