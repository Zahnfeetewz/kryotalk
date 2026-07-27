const path = require('path');
const fs = require('fs');
const os = require('os');
const { JsonDB } = require('./src/db');
const { createServer } = require('./src/server');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv6' && !net.internal) return net.address;
    }
  }
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const dataDir = path.join(os.homedir(), '.discord-klon');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const db = new JsonDB(path.join(dataDir, 'db.json'));

createServer(db, uploadsDir, getLocalIP);
