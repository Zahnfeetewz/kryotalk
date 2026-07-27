const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cfgPath = path.join(os.homedir(), '.discord-klon', 'email-config.json');
console.log('Config-Pfad:', cfgPath);
console.log('Existiert:', fs.existsSync(cfgPath));

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
console.log('Host:', cfg.host, 'Port:', cfg.port, 'User:', cfg.user);

const transport = nodemailer.createTransport({
  host: cfg.host, port: cfg.port, secure: !!cfg.secure,
  auth: { user: cfg.user, pass: cfg.pass },
  tls: { rejectUnauthorized: false }
});

console.log('Sende Test-Email an alinadupre16@gmail.com...');

transport.sendMail({
  from: '"KryoTalk" <kryotalk.verify@gmail.com>',
  to: 'alinadupre16@gmail.com',
  subject: 'KryoTalk - Test Verifizierung',
  html: '<h2>Test Code: 123456</h2>'
}).then(info => {
  console.log('ERFOLG! MessageId:', info.messageId);
}).catch(e => {
  console.log('FEHLER:', e.message);
  console.log('Code:', e.code);
  console.log('Command:', e.command);
});
