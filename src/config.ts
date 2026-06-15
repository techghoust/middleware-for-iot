import { config } from 'dotenv';

config();

export const CONFIG = {
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    topics: (process.env.MQTT_TOPICS || 'home/#').split(','),
  },
  http: {
    port: parseInt(process.env.HTTP_PORT || '3000', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
