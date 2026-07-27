const { exec } = require('child_process');
const path = require('path');

const PORT = 3000;

console.log('Starting server...');
const server = require('./src/server');

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on http://localhost:' + PORT);
  console.log('\nStarting cloudflared tunnel...');

  const tunnel = exec('"' + path.join(__dirname, 'cloudflared.exe') + '" tunnel --url http://localhost:' + PORT);

  tunnel.stdout.on('data', d => {
    const text = d.toString();
    process.stdout.write(text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log('\n========================================');
      console.log('  PUBLIC URL: ' + match[0]);
      console.log('========================================');
      console.log('  Share this link with anyone!');
      console.log('  Press Ctrl+C to stop.\n');
    }
  });

  tunnel.stderr.on('data', d => process.stderr.write(d));

  process.on('SIGINT', () => {
    tunnel.kill();
    process.exit();
  });
});
