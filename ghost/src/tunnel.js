const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CF_PATH = path.join(__dirname, '..', 'cloudflared.exe');
const URL_FILE = path.join(__dirname, '..', '.tunnel-url');

function startTunnel(port) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CF_PATH)) {
      console.log('cloudflared.exe nicht gefunden. Bitte manuell herunterladen:');
      console.log('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
      return reject(new Error('cloudflared.exe fehlt'));
    }

    const proc = exec('"' + CF_PATH + '" tunnel --url http://localhost:' + port);
    let resolved = false;
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        const url = match[0];
        fs.writeFileSync(URL_FILE, url);
        console.log('\n=== Ghost Messenger ===');
        console.log('URL: ' + url);
        console.log('========================\n');
        resolve(url);
      }
    });
    proc.stderr.on('data', () => {});
    process.on('SIGINT', () => { proc.kill(); process.exit(); });
  });
}

if (require.main === module) {
  startTunnel(process.argv[2] || 4000).catch(console.error);
}

module.exports = { startTunnel };
