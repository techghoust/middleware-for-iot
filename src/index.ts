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

const rules: RouteRule[] = [
  {
    name: 'all-telemetry-to-console',
    match: { type: 'telemetry.*' },
    destinations: CONFIG.webhook.url ? ['console', 'webhook'] : ['console'],
  },
];

const dispatcher = new Dispatcher();

dispatcher.register({
  name: 'console',
  send: async (msg: BridgeMessage) => {
    logger.info('Console', `Received message`, { type: msg.type, id: msg.id });
    console.log(JSON.stringify(msg, null, 2));
  },
});

if (CONFIG.webhook.url) {
  dispatcher.register(
    reliableTarget(
      createWebhookTarget('webhook', CONFIG.webhook.url, CONFIG.webhook.timeoutMs),
      CONFIG.webhook
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
  }
};

const mqtt = new MqttIngressAdapter(CONFIG.mqtt.brokerUrl, CONFIG.mqtt.topics);
mqtt.on('message', handleMessage);

const http = new HttpIngressAdapter(CONFIG.http.port);
http.on('message', handleMessage);

const websocket = new WebSocketIngressAdapter(CONFIG.websocket.port);
websocket.on('message', handleMessage);

logger.info('DataBridge', `System started!`, {
  mqttBroker: CONFIG.mqtt.brokerUrl,
  httpPort: CONFIG.http.port,
  websocketPort: CONFIG.websocket.port,
});
