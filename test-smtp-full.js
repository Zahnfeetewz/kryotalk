const path = require('path');
const os = require('os');
const fs = require('fs');
const nodemailer = require('nodemailer');

function getTransporter() {
  try {
    const cfgPath = path.join(os.homedir(), '.discord-klon', 'email-config.json');
    console.log('[Test] Config-Pfad:', cfgPath);
    console.log('[Test] Config existiert:', fs.existsSync(cfgPath));
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    console.log('[Test] SMTP Host:', cfg.host, 'Port:', cfg.port);
    const t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: !!cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, tls: { rejectUnauthorized: false } });
    console.log('[Test] Transporter erstellt:', !!t);
    return t;
  } catch (e) {
    console.log('[Test] FEHLER beim Erstellen:', e.message);
    return null;
  }
}

async function sendVerificationEmail(email, code, username) {
  const transport = getTransporter();
  if (!transport) {
    console.log('[Test] KEIN Transporter - Dev-Modus');
    return { ok: true, devMode: true, reason: 'Kein SMTP-Transporter' };
  }
  try {
    console.log('[Test] Sende Email an', email, '...');
    const info = await transport.sendMail({
      from: '"KryoTalk" <kryotalk.verify@gmail.com>',
      to: email,
      subject: 'KryoTalk - E-Mail verifizieren',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#2b2d31;border-radius:12px;color:#fff">' +
        '<h2 style="color:#5865f2;text-align:center">E-Mail verifizieren</h2>' +
        '<p>Hallo <b>' + username + '</b>,</p>' +
        '<p>Verifiziere deine E-Mail-Adresse mit dem folgenden Code:</p>' +
        '<div style="text-align:center;margin:24px 0"><span style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#5865f2;padding:12px 24px;border-radius:8px;display:inline-block">' + code + '</span></div>' +
        '<p style="font-size:13px;color:#b5bac1">Dieser Code ist 5 Minuten g&uuml;ltig.</p>' +
        '</div>'
    });
    console.log('[Test] ERFOLG! MessageId:', info.messageId);
    return { ok: true, devMode: false };
  } catch (e) {
    console.log('[Test] FEHLER beim Senden:', e.message);
    console.log('[Test] Fehler-Code:', e.code);
    console.log('[Test] Fehler-Command:', e.command);
    console.log('[Test] Stack:', e.stack);
    return { ok: true, devMode: true, reason: e.message };
  }
}

(async () => {
  console.log('=== SMTP Full Test (gleicher Code-Pfad wie App) ===');
  const result = await sendVerificationEmail('alinadupre16@gmail.com', '888888', 'TestUser');
  console.log('[Test] Ergebnis:', JSON.stringify(result));
})();
