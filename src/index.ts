import { CONFIG } from './config';
import { MqttIngressAdapter } from './adapters/mqtt-ingress';
import { HttpIngressAdapter } from './adapters/http-ingress';
import { createWebhookTarget } from './adapters/webhook-egress';
import { MessageRouter, RouteRule } from './core/router';
import { Dispatcher } from './core/dispatcher';
import { BridgeMessage } from './types/bridge-message';
import { logger } from './observability/logger';

const rules: RouteRule[] = [
  {
    name: 'all-telemetry-to-console',
    match: { type: 'telemetry.*' },
    destinations: ['console'],
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

dispatcher.register(createWebhookTarget('my-webhook', 'https://webhook.site/your-id-here'));

const router = new MessageRouter(rules);

const handleMessage = async (msg: BridgeMessage) => {
  const destinations = router.route(msg);
  await dispatcher.dispatch(msg, destinations);
};

const mqtt = new MqttIngressAdapter(CONFIG.mqtt.brokerUrl, CONFIG.mqtt.topics);
mqtt.on('message', handleMessage);

const http = new HttpIngressAdapter(CONFIG.http.port);
http.on('message', handleMessage);

logger.info('DataBridge', `System started!`, {
  mqttBroker: CONFIG.mqtt.brokerUrl,
  httpPort: CONFIG.http.port,
});
