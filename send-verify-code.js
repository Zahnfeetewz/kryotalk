const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: 'kryotalk.verify@gmail.com', pass: 'jdkm bfko qsqm llaq' }
});
t.sendMail({
  from: '"KryoTalk" <kryotalk.verify@gmail.com>',
  to: 'duprekejo@gmail.com',
  subject: 'E-Mail-Adresse verifizieren',
  html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#2b2d31;border-radius:12px;color:#fff">' +
    '<h2 style="color:#5865f2;text-align:center">E-Mail verifizieren</h2>' +
    '<p>Hallo <b>lol</b>,</p>' +
    '<p>Verifiziere deine E-Mail-Adresse mit dem folgenden Code:</p>' +
    '<div style="text-align:center;margin:24px 0"><span style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#5865f2;padding:12px 24px;border-radius:8px;display:inline-block">619629</span></div>' +
    '<p style="font-size:13px;color:#b5bac1">Dieser Code ist 5 Minuten g\u00fcltig.</p>' +
    '</div>'
}).then(r => console.log('OK:', r.messageId)).catch(e => console.log('FEHLER:', e.message));
