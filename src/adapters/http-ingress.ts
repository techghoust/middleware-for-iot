import Fastify from 'fastify';
import { EventEmitter } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';

export class HttpIngressAdapter extends EventEmitter {
  private server = Fastify({ logger: false });

  constructor(port: number) {
    super();

    this.server.post('/ingest/:type', async (request, reply) => {
      const { type } = request.params as { type: string };
      const body = request.body as Record<string, unknown>;

      try {
        const message: BridgeMessage = normalize('http', type, body);
        logger.info('HTTP', `Received message`, { type: message.type, id: message.id });
        this.emit('message', message);
        return reply.status(200).send({ ok: true, id: message.id });
      } catch (error) {
        logger.error('HTTP', `Failed to process request`, { error: String(error), type });
        return reply.status(400).send({ ok: false, error: String(error) });
      }
    });

    this.server.listen({ port, host: '0.0.0.0' }, () => {
      logger.info('HTTP', `Listening on port ${port}`);
    });
  }

  async stop() {
    await this.server.close();
    logger.info('HTTP', `Server stopped`);
  }
}
