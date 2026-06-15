import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  const message = JSON.stringify({ value: 23.4, unit: 'celsius' });
  client.publish('home/room42/temperature', message);
  console.log('Message sent!');
  client.end();
});
