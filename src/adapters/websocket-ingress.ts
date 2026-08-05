import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';

export class WebSocketIngressAdapter extends EventEmitter {
  private server: WebSocketServer;

  constructor(port: number) {
    super();

    this.server = new WebSocketServer({ port });

    this.server.on('listening', () => {
      logger.info('WebSocket', `Listening on port ${port}`);
    });

    this.server.on('connection', (socket, req) => {
      const clientId = req?.socket?.remoteAddress || `websocket-client-${Date.now()}`;
      logger.info('WebSocket', `Client connected`, { clientId });

      socket.on('message', (rawPayload) => {
        try {
          const data = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : JSON.parse(rawPayload.toString());
          if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid message payload');
          }

          const { type, payload } = data as { type: string; payload: unknown };

          if (!type || typeof type !== 'string') {
            throw new Error('Missing or invalid message type');
          }

          if (typeof payload !== 'object' || payload === null) {
            throw new Error('Missing or invalid payload');
          }

          const message: BridgeMessage = normalize('websocket', type, payload);
          this.emit('message', message);
          socket.send(JSON.stringify({ ok: true, id: message.id }));
        } catch (error) {
          logger.error('WebSocket', `Failed to process message`, {
            error: String(error),
            clientId,
          });
          socket.send(JSON.stringify({ ok: false, error: String(error) }));
        }
      });

      socket.on('close', () => {
        logger.info('WebSocket', `Client disconnected`, { clientId });
      });
    });

    this.server.on('error', (error) => {
      logger.error('WebSocket', `Server error`, { error: String(error) });
    });
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    logger.info('WebSocket', `Server stopped`);
  }
}
