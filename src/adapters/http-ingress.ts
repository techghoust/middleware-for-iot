import Fastify from 'fastify';
import { EventEmitter, once } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';
import {
  DiagnosticCategory,
  DiagnosticHub,
  DiagnosticProtocol,
} from '../observability/diagnostics';
import { diagnosticsDashboard } from '../observability/dashboard';

const CATEGORIES = new Set<DiagnosticCategory | 'all'>([
  'all',
  'connection',
  'message',
  'error',
  'retry',
  'sandbox',
  'system',
]);

export class HttpIngressAdapter extends EventEmitter {
  private server = Fastify({ logger: false });

  constructor(
    port: number,
    private readonly diagnostics?: DiagnosticHub,
    websocketPort = 3002,
    diagnosticsEnabled = true
  ) {
    super();

    this.server.post('/ingest/:type', async (request, reply) => {
      const { type } = request.params as { type: string };
      const body = request.body as Record<string, unknown>;
      const clientId = `http:${request.ip}`;
      const test = request.headers['x-databridge-test'] === 'true';

      try {
        const message: BridgeMessage = normalize('http', type, body, { sourceId: clientId, test });
        logger.info('HTTP', 'Received message', { type: message.type, id: message.id });
        this.diagnostics?.recordMessage(
          'incoming',
          'http',
          clientId,
          test ? 'test message received' : 'message received',
          { type: message.type, payload: message.payload, id: message.id, test: message.meta.test }
        );
        this.emit('message', message);
        return reply.status(200).send({ ok: true, id: message.id });
      } catch (error) {
        logger.error('HTTP', 'Failed to process request', { error: String(error), type });
        this.diagnostics?.recordError(
          'http',
          'protocol_error',
          'failed to process HTTP message',
          clientId,
          { type, error: String(error) }
        );
        return reply.status(400).send({ ok: false, error: String(error) });
      }
    });

    if (this.diagnostics && diagnosticsEnabled) {
      this.registerDiagnostics(websocketPort);
    }

    this.server.listen({ port, host: '0.0.0.0' }, (error) => {
      if (error) {
        logger.error('HTTP', 'Failed to listen', { error: String(error), port });
        this.diagnostics?.recordError(
          'http',
          'server_error',
          'HTTP server failed to listen',
          undefined,
          {
            port,
            error: String(error),
          }
        );
        return;
      }
      logger.info('HTTP', `Listening on port ${port}`);
    });
  }

  private registerDiagnostics(websocketPort: number): void {
    const diagnostics = this.diagnostics;
    if (!diagnostics) return;

    this.server.get('/diagnostics', async (_request, reply) => {
      return reply.type('text/html; charset=utf-8').send(diagnosticsDashboard(websocketPort));
    });

    this.server.get('/diagnostics/api/snapshot', async (request) => {
      const query = request.query as {
        category?: string;
        search?: string;
        protocol?: string;
        status?: string;
        clientId?: string;
        limit?: string;
      };
      const category = CATEGORIES.has(query.category as DiagnosticCategory | 'all')
        ? (query.category as DiagnosticCategory | 'all')
        : 'all';
      const limit = Number.parseInt(query.limit ?? '100', 10);
      return diagnostics.snapshot({
        category,
        search: query.search,
        protocol: query.protocol as DiagnosticProtocol | undefined,
        status: query.status,
        clientId: query.clientId,
        limit: Number.isFinite(limit) ? limit : 100,
      });
    });

    this.server.put('/diagnostics/api/sandbox', async (request, reply) => {
      try {
        if (typeof request.body !== 'object' || request.body === null) {
          throw new Error('request body must be an object');
        }
        return diagnostics.configureSandbox(request.body);
      } catch (error) {
        return reply.status(400).send({ ok: false, error: String(error) });
      }
    });

    this.server.post('/diagnostics/api/sandbox/reset', async () => {
      return diagnostics.resetSandbox();
    });
  }

  async ready(): Promise<number> {
    if (!this.server.server.address()) await once(this.server.server, 'listening');
    const address = this.server.server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP address is unavailable');
    return address.port;
  }

  async stop() {
    await this.server.close();
    logger.info('HTTP', 'Server stopped');
  }
}
