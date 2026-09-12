import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter, once } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';
import { DiagnosticHub } from '../observability/diagnostics';

export class WebSocketIngressAdapter extends EventEmitter {
  private server: WebSocketServer;

  constructor(
    port: number,
    private readonly diagnostics?: DiagnosticHub
  ) {
    super();

    this.server = new WebSocketServer({ port });

    this.server.on('listening', () => {
      logger.info('WebSocket', `Listening on port ${port}`);
    });

    this.server.on('connection', (socket, req) => {
      const fallbackId = `${req.socket.remoteAddress ?? 'websocket-client'}:${req.socket.remotePort ?? 'unknown'}`;
      const requestedId = new URL(req.url ?? '/', 'ws://localhost').searchParams
        .get('clientId')
        ?.trim();
      const clientId =
        requestedId && /^[a-zA-Z0-9._:-]{1,128}$/.test(requestedId) ? requestedId : fallbackId;
      const send = (payload: unknown): boolean => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        try {
          socket.send(JSON.stringify(payload));
          return true;
        } catch (error) {
          this.diagnostics?.recordError(
            'websocket',
            'send_error',
            'failed to send WebSocket response',
            clientId,
            { error: String(error) }
          );
          return false;
        }
      };

      logger.info('WebSocket', 'Client connected', { clientId });
      this.transitionConnection(clientId, 'ONLINE', 'WebSocket opened');

      socket.on('message', async (rawPayload) => {
        try {
          const simulation = await this.diagnostics?.simulate(clientId, 'websocket');
          if (simulation && !simulation.deliver) {
            send({ ok: false, simulated: true, reason: simulation.reason });
            return;
          }

          const data = JSON.parse(rawPayload.toString());
          if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid message payload');
          }

          const { type, payload, test } = data as {
            type: string;
            payload: unknown;
            test?: boolean;
          };

          if (!type || typeof type !== 'string') {
            throw new Error('Missing or invalid message type');
          }

          if (typeof payload !== 'object' || payload === null) {
            throw new Error('Missing or invalid payload');
          }

          const message: BridgeMessage = normalize('websocket', type, payload, {
            sourceId: clientId,
            test: test === true,
          });
          this.diagnostics?.recordMessage(
            'incoming',
            'websocket',
            clientId,
            test === true ? 'test message received' : 'message received',
            {
              type: message.type,
              payload: message.payload,
              id: message.id,
              test: message.meta.test,
            }
          );
          this.emit('message', message);

          const response = { ok: true, id: message.id };
          if (send(response)) {
            this.diagnostics?.recordMessage(
              'outgoing',
              'websocket',
              clientId,
              'acknowledgement sent',
              response
            );
          }
        } catch (error) {
          logger.error('WebSocket', 'Failed to process message', {
            error: String(error),
            clientId,
          });
          this.diagnostics?.recordError(
            'websocket',
            'protocol_error',
            'failed to process WebSocket message',
            clientId,
            { error: String(error) }
          );
          send({ ok: false, error: String(error) });
        }
      });

      socket.on('error', (error) => {
        this.transitionConnection(clientId, 'ERROR', 'WebSocket error', {
          error: String(error),
        });
      });

      socket.on('close', (code, reason) => {
        logger.info('WebSocket', 'Client disconnected', { clientId, code });
        this.transitionConnection(clientId, 'OFFLINE', 'WebSocket closed', {
          code,
          reason: reason.toString(),
        });
      });
    });

    this.server.on('error', (error) => {
      logger.error('WebSocket', 'Server error', { error: String(error) });
      this.diagnostics?.recordError(
        'websocket',
        'server_error',
        'WebSocket server error',
        undefined,
        {
          error: String(error),
        }
      );
    });
  }

  async ready(): Promise<number> {
    if (!this.server.address()) await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('WebSocket address is unavailable');
    return address.port;
  }

  private transitionConnection(
    clientId: string,
    state: 'ONLINE' | 'OFFLINE' | 'ERROR',
    trigger: string,
    details?: unknown
  ): void {
    const snapshot = this.diagnostics?.transition(clientId, 'websocket', state, trigger, details);
    if (snapshot) this.emit('connection-state', snapshot);
  }

  async stop() {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    logger.info('WebSocket', 'Server stopped');
  }
}
