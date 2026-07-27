const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.static(path.join(__dirname, '..', 'static')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const identityPackages = new Map();

function saveQueue(userId, queue) {
  const fp = path.join(DATA_DIR, userId + '.queue');
  fs.writeFileSync(fp, JSON.stringify(queue));
}

function loadQueue(userId) {
  const fp = path.join(DATA_DIR, userId + '.queue');
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return []; }
  }
  return [];
}

function deleteQueue(userId) {
  const fp = path.join(DATA_DIR, userId + '.queue');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'identify') {
      userId = msg.userId;
      if (!userId || typeof userId !== 'string' || userId.length > 128) return;
      clients.set(userId, ws);

      if (msg.identityPackage) {
        identityPackages.set(userId, msg.identityPackage);
      }

      const queue = loadQueue(userId);
      if (queue.length > 0) {
        for (const queued of queue) {
          if (ws.readyState === 1) ws.send(JSON.stringify(queued));
        }
        deleteQueue(userId);
      }

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'identified', userId }));
      }
      return;
    }

    if (msg.type === 'publish_identity' && msg.identityPackage && userId) {
      identityPackages.set(userId, msg.identityPackage);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'identity_published' }));
      }
      return;
    }

    if (msg.type === 'fetch_identity' && msg.userId) {
      const pkg = identityPackages.get(msg.userId);
      const isOnline = clients.has(msg.userId);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'identity_response',
          userId: msg.userId,
          online: isOnline,
          identityPackage: pkg || null,
        }));
      }
      return;
    }

    if (msg.type === 'message' && msg.to && userId) {
      const recipientWs = clients.get(msg.to);
      const envelope = {
        type: 'message',
        from: userId,
        body: msg.body,
        ephemeral: msg.ephemeral || false,
        timestamp: Date.now(),
      };

      if (recipientWs && recipientWs.readyState === 1) {
        recipientWs.send(JSON.stringify(envelope));
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'delivery_receipt', msgId: msg.msgId, to: msg.to }));
        }
      } else {
        const queue = loadQueue(msg.to);
        queue.push(envelope);
        saveQueue(msg.to, queue);
      }
      return;
    }

    if (msg.type === 'session_init' && msg.to && msg.ephemeralPublicKey && userId) {
      const envelope = {
        type: 'session_init',
        from: userId,
        ephemeralPublicKey: msg.ephemeralPublicKey,
        identityPublicKey: msg.identityPublicKey || null,
      };
      const recipientWs = clients.get(msg.to);
      if (recipientWs && recipientWs.readyState === 1) {
        recipientWs.send(JSON.stringify(envelope));
      } else {
        const queue = loadQueue(msg.to);
        queue.push(envelope);
        saveQueue(msg.to, queue);
      }
      return;
    }

    if (msg.type === 'ping' && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    if (userId) clients.delete(userId);
  });

  ws.on('error', () => {
    if (userId) clients.delete(userId);
  });

  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'welcome' }));
  }
});

setInterval(() => {
  for (const [uid, ws] of clients) {
    if (ws.readyState !== 1) {
      clients.delete(uid);
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Ghost v2 relay running on port ' + PORT);
});
