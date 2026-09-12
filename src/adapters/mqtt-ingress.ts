import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import { normalize } from '../core/normalizer';
import { BridgeMessage } from '../types/bridge-message';
import { logger } from '../observability/logger';
import { DiagnosticHub } from '../observability/diagnostics';

function safeBrokerName(brokerUrl: string): string {
  try {
    const url = new URL(brokerUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'mqtt-broker';
  }
}

export class MqttIngressAdapter extends EventEmitter {
  private client: mqtt.MqttClient;
  private readonly clientId: string;
  private readonly brokerName: string;

  constructor(
    brokerUrl: string,
    topics: string[],
    private readonly diagnostics?: DiagnosticHub
  ) {
    super();
    this.brokerName = safeBrokerName(brokerUrl);
    this.clientId = `mqtt:${this.brokerName}`;
    this.diagnostics?.transition(this.clientId, 'mqtt', 'CONNECTING', 'MQTT connection started');
    this.client = mqtt.connect(brokerUrl);

    this.client.on('connect', () => {
      logger.info('MQTT', `Connected to ${this.brokerName}`);
      this.diagnostics?.transition(this.clientId, 'mqtt', 'ONLINE', 'MQTT connected');
      topics.forEach((topic) => {
        this.client.subscribe(topic);
        logger.info('MQTT', `Subscribed to ${topic}`);
      });
    });

    this.client.on('message', async (topic: string, rawPayload: Buffer) => {
      try {
        const simulation = await this.diagnostics?.simulate(this.clientId, 'mqtt');
        if (simulation && !simulation.deliver) return;

        const data = JSON.parse(rawPayload.toString());
        const message: BridgeMessage = normalize('mqtt', topic, data, { sourceId: this.clientId });
        this.diagnostics?.recordMessage('incoming', 'mqtt', this.clientId, 'message received', {
          topic,
          type: message.type,
          payload: message.payload,
          id: message.id,
        });
        this.emit('message', message);
      } catch (error) {
        logger.error('MQTT', `Failed to process message from ${topic}`, { error: String(error) });
        this.diagnostics?.recordError(
          'mqtt',
          'protocol_error',
          'failed to process MQTT message',
          this.clientId,
          { topic, error: String(error) }
        );
      }
    });

    this.client.on('reconnect', () => {
      this.diagnostics?.transition(this.clientId, 'mqtt', 'RETRYING', 'MQTT reconnect started');
    });

    this.client.on('offline', () => {
      this.diagnostics?.transition(this.clientId, 'mqtt', 'OFFLINE', 'MQTT client offline');
    });

    this.client.on('error', (error) => {
      logger.error('MQTT', 'Connection error', { broker: this.brokerName, error: String(error) });
      this.diagnostics?.transition(this.clientId, 'mqtt', 'ERROR', 'MQTT connection error', {
        error: String(error),
      });
    });

    this.client.on('disconnect', () => {
      logger.warn('MQTT', `Disconnected from ${this.brokerName}`);
      this.diagnostics?.transition(this.clientId, 'mqtt', 'OFFLINE', 'MQTT disconnected');
    });
  }

  disconnect() {
    this.client.end();
    logger.info('MQTT', 'Disconnected');
  }
}
