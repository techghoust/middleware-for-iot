const http = require('node:http');
const attempts = new Map();
const failFirst = Number(process.env.FAIL_FIRST || 0);
http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.end('ok');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/events') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1048576) req.destroy();
    });
    req.on('end', () => {
      try {
        const message = JSON.parse(body);
        const attempt = (attempts.get(message.id) || 0) + 1;
        attempts.set(message.id, attempt);
        const status = attempt <= failFirst ? 503 : 200;
        console.log(JSON.stringify({ status, attempt, message }));
        res
          .writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ok: status === 200 }));
      } catch {
        res.writeHead(400).end();
      }
    });
  })
  .listen(3001, '0.0.0.0', () => console.log('Demo webhook listening on 3001'));
