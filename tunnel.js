const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
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

const PORT = process.env.PORT || 3000;

createServer(db, uploadsDir, getLocalIP);

const cloudflaredBin = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');

console.log('');
console.log('Starte Cloudflare Quick Tunnel...');
console.log('(Kostenlos, kein Account noetig, HTTPS inklusive)');
console.log('');

const child = spawn(cloudflaredBin, ['tunnel', '--url', 'http://localhost:' + PORT], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let urlFound = false;

child.stdout.on('data', function (data) {
  const text = data.toString();
  process.stdout.write(text);
  if (!urlFound) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      urlFound = true;
      console.log('');
      console.log('================================================');
      console.log('  TUNNEL AKTIV!');
      console.log('');
      console.log('  Oeffne diese URL im Browser:');
      console.log('  ' + match[0]);
      console.log('');
      console.log('  Jeder auf der Welt kann jetzt zugreifen!');
      console.log('  (Tunnel-URL ist temporaer — bei Neustart neue URL)');
      console.log('================================================');
      console.log('');
    }
  }
});

child.stderr.on('data', function (data) {
  const text = data.toString();
  process.stderr.write(text);
  if (!urlFound) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      urlFound = true;
      console.log('');
      console.log('================================================');
      console.log('  TUNNEL AKTIV!');
      console.log('');
      console.log('  Oeffne diese URL im Browser:');
      console.log('  ' + match[0]);
      console.log('');
      console.log('  Jeder auf der Welt kann jetzt zugreifen!');
      console.log('  (Tunnel-URL ist temporaer — bei Neustart neue URL)');
      console.log('================================================');
      console.log('');
    }
  }
});

child.on('error', function (err) {
  console.error('Tunnel-Fehler:', err.message);
});

child.on('exit', function (code) {
  console.log('Tunnel beendet (Code: ' + code + ')');
  process.exit(code || 0);
});

process.on('SIGINT', function () { child.kill(); process.exit(0); });
process.on('SIGTERM', function () { child.kill(); process.exit(0); });
