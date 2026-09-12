import { CONFIG } from './config';
import { reliableTarget } from './core/reliable-target';
import { MqttIngressAdapter } from './adapters/mqtt-ingress';
import { HttpIngressAdapter } from './adapters/http-ingress';
import { WebSocketIngressAdapter } from './adapters/websocket-ingress';
import { createWebhookTarget } from './adapters/webhook-egress';
import { MessageRouter, RouteRule } from './core/router';
import { Dispatcher } from './core/dispatcher';
import { BridgeMessage } from './types/bridge-message';
import { logger } from './observability/logger';
import { DiagnosticHub, redactSensitive } from './observability/diagnostics';

const diagnostics = CONFIG.diagnostics.enabled
  ? new DiagnosticHub({
      maxEvents: CONFIG.diagnostics.maxEvents,
      maxConnections: CONFIG.diagnostics.maxConnections,
    })
  : undefined;
diagnostics?.configureSandbox(CONFIG.diagnostics.sandbox);

const rules: RouteRule[] = [
  {
    name: 'all-telemetry-to-console',
    match: { type: 'telemetry.*' },
    destinations: CONFIG.webhook.url ? ['console', 'webhook'] : ['console'],
  },
];

const dispatcher = new Dispatcher(diagnostics);

dispatcher.register({
  name: 'console',
  send: async (msg: BridgeMessage) => {
    logger.info('Console', `Received message`, { type: msg.type, id: msg.id });
    console.log(JSON.stringify(redactSensitive(msg), null, 2));
  },
});

if (CONFIG.webhook.url) {
  dispatcher.register(
    reliableTarget(
      createWebhookTarget('webhook', CONFIG.webhook.url, CONFIG.webhook.timeoutMs),
      CONFIG.webhook,
      diagnostics
    )
  );
} else {
  logger.warn('DataBridge', 'WEBHOOK_URL is unset; only console delivery is enabled');
}

const router = new MessageRouter(rules);

const handleMessage = async (msg: BridgeMessage) => {
  try {
    const destinations = router.route(msg);
    await dispatcher.dispatch(msg, destinations);
  } catch (error) {
    logger.error('DataBridge', 'Pipeline failed', { id: msg.id, error: String(error) });
    diagnostics?.recordError(
      'system',
      'middleware_error',
      'message pipeline failed',
      msg.source.id,
      {
        id: msg.id,
        type: msg.type,
        error: String(error),
      }
    );
  }
};

const mqtt = new MqttIngressAdapter(CONFIG.mqtt.brokerUrl, CONFIG.mqtt.topics, diagnostics);
mqtt.on('message', handleMessage);

const http = new HttpIngressAdapter(
  CONFIG.http.port,
  diagnostics,
  CONFIG.websocket.port,
  CONFIG.diagnostics.enabled
);
http.on('message', handleMessage);

const websocket = new WebSocketIngressAdapter(CONFIG.websocket.port, diagnostics);
websocket.on('message', handleMessage);

logger.info('DataBridge', `System started!`, {
  httpPort: CONFIG.http.port,
  websocketPort: CONFIG.websocket.port,
  diagnostics: CONFIG.diagnostics.enabled,
});
diagnostics?.record({
  category: 'system',
  type: 'middleware_started',
  message: 'DataBridge started',
  direction: 'internal',
  protocol: 'system',
  status: 'online',
  details: {
    httpPort: CONFIG.http.port,
    websocketPort: CONFIG.websocket.port,
    diagnostics: CONFIG.diagnostics.enabled,
  },
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  diagnostics?.record({
    category: 'system',
    type: 'middleware_stopping',
    message: `DataBridge stopping after ${signal}`,
    direction: 'internal',
    protocol: 'system',
    status: 'stopping',
  });
  mqtt.disconnect();
  const results = await Promise.allSettled([http.stop(), websocket.stop()]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    logger.error('DataBridge', 'Shutdown completed with errors', { failures: failures.length });
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
