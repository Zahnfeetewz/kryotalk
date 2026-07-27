const path = require('path');
const os = require('os');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Exakt gleicher Code wie in main.js und server.js
let emailTransporter = null;
function getTransporter() {
  if (emailTransporter) return emailTransporter;
  try {
    const cfgPath = path.join(os.homedir(), '.discord-klon', 'email-config.json');
    console.log('[Transporter] Config:', cfgPath, 'exists:', fs.existsSync(cfgPath));
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      emailTransporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: !!cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
        tls: { rejectUnauthorized: false }
      });
      console.log('[Transporter] Erstellt OK');
      return emailTransporter;
    }
  } catch (e) { console.log('[Transporter] FEHLER:', e.message); }
  return null;
}

async function sendVerificationEmail(email, code, username) {
  const transport = getTransporter();
  if (!transport) {
    console.log('[Mail] KEIN Transporter!');
    return { ok: true, devMode: true };
  }
  try {
    console.log('[Mail] Sendet an', email, '...');
    const info = await transport.sendMail({
      from: '"KryoTalk" <kryotalk.verify@gmail.com>',
      to: email,
      subject: 'KryoTalk - E-Mail verifizieren',
      html: '<h2>Code: ' + code + '</h2>'
    });
    console.log('[Mail] Gesendet! ID:', info.messageId);
    console.log('[Mail] Response:', JSON.stringify(info.response));
    return { ok: true, devMode: false };
  } catch (e) {
    console.log('[Mail] FEHLER:', e.message);
    console.log('[Mail] Code:', e.code);
    console.log('[Mail] Command:', e.command);
    return { ok: true, devMode: true, reason: e.message };
  }
}

// Simuliere exakt den Register-Flow aus main.js
(async () => {
  const email = 'alinadupre16@gmail.com';
  const code = '123456';
  const username = 'TestUser';

  console.log('=== Simuliere Register-Flow ===');
  console.log('1. getTransporter() aufrufen...');
  const t = getTransporter();
  console.log('2. Transporter:', t ? 'OK' : 'NULL');

  console.log('3. sendVerificationEmail() aufrufen...');
  const result = await sendVerificationEmail(email, code, username);
  console.log('4. Ergebnis:', JSON.stringify(result));
})();
