import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';

export class MqttIngressAdapter extends EventEmitter {
  private client: mqtt.MqttClient;

  constructor(brokerUrl: string, topics: string[]) {
    super();
    this.client = mqtt.connect(brokerUrl);

    this.client.on('connect', () => {
      logger.info('MQTT', `Connected to ${brokerUrl}`);
      topics.forEach((topic) => {
        this.client.subscribe(topic);
        logger.info('MQTT', `Subscribed to ${topic}`);
      });
    });

    this.client.on('message', (topic: string, rawPayload: Buffer) => {
      try {
        const data = JSON.parse(rawPayload.toString());
        const message: BridgeMessage = normalize('mqtt', topic, data);
        this.emit('message', message);
      } catch (error) {
        logger.error('MQTT', `Failed to process message from ${topic}`, { error: String(error) });
      }
    });

    this.client.on('error', (error) => {
      logger.error('MQTT', `Connection error`, { error: String(error) });
    });

    this.client.on('disconnect', () => {
      logger.warn('MQTT', `Disconnected from ${brokerUrl}`);
    });
  }

  disconnect() {
    this.client.end();
    logger.info('MQTT', `Disconnected`);
  }
}
