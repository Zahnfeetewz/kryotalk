const auth = require('./src/auth');
const { JsonDB } = require('./src/db');
const path = require('path');
const os = require('os');
const nodemailer = require('nodemailer');

const db = new JsonDB(path.join(os.homedir(), '.discord-klon', 'db.json'));

async function test() {
  const r = auth.register(db, { username: 'mailtest2', password: 'test123', email: 'duprekejo@gmail.com' });
  if (!r.ok) { console.log('Reg-Fehler:', r.error); return; }
  console.log('User erstellt:', r.user.id);

  const user = db.getUserById(r.user.id);
  console.log('verificationCode:', user.verificationCode);

  const cfgPath = path.join(os.homedir(), '.discord-klon', 'email-config.json');
  const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));
  console.log('Config geladen:', cfg.host, cfg.port);

  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: !!cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });

  try {
    const info = await transport.sendMail({
      from: '"KryoTalk" <kryotalk.verify@gmail.com>',
      to: 'duprekejo@gmail.com',
      subject: 'E-Mail-Adresse verifizieren',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#2b2d31;border-radius:12px;color:#fff">' +
        '<h2 style="color:#5865f2;text-align:center">E-Mail verifizieren</h2>' +
        '<p>Hallo <b>mailtest2</b>,</p>' +
        '<p>Verifiziere deine E-Mail-Adresse mit dem folgenden Code:</p>' +
        '<div style="text-align:center;margin:24px 0"><span style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#5865f2;padding:12px 24px;border-radius:8px;display:inline-block">' + user.verificationCode + '</span></div>' +
        '<p style="font-size:13px;color:#b5bac1">Dieser Code ist 15 Minuten g\u00fcltig.</p>' +
        '</div>'
    });
    console.log('Erfolgreich gesendet! MessageId:', info.messageId);
  } catch (e) {
    console.log('FEHLER beim Senden:', e.message);
  }

  db.deleteUser(r.user.id);
  console.log('Testuser geloescht');
}

test();
