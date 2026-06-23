require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SECRET = process.env.WEBHOOK_SECRET;
const PORT = 3001;
const APP_DIR = '/opt/matheherz';

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    return res.end();
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const sig = req.headers['x-hub-signature-256'];
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(expected))) {
      res.writeHead(401);
      return res.end('Unauthorized');
    }

    const event = req.headers['x-github-event'];
    const payload = JSON.parse(body);

    if (event === 'push' && payload.ref === 'refs/heads/master') {
      res.writeHead(200);
      res.end('Deploying...');

      try {
        execSync(`cd ${APP_DIR} && git pull origin master && npm install && pm2 restart matheherz`, {
          stdio: 'inherit'
        });
        console.log('Deploy erfolgreich');
      } catch (e) {
        console.error('Deploy fehlgeschlagen:', e.message);
      }
    } else {
      res.writeHead(200);
      res.end('Ignored');
    }
  });
}).listen(PORT, () => console.log(`Webhook läuft auf Port ${PORT}`));
