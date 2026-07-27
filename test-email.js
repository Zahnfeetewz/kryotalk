const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'kryotalk.verify@gmail.com',
    pass: 'jdkm bfko qsqm llaq'
  }
});
t.verify()
  .then(() => console.log('SMTP Verbindung OK'))
  .catch(e => console.log('SMTP FEHLER:', e.message));
t.sendMail({
  from: '"KryoTalk" <kryotalk.verify@gmail.com>',
  to: 'duprekejo@gmail.com',
  subject: 'Test',
  html: '<h1>Test-Mail</h1>'
}).then(r => console.log('Gesendet:', r.messageId))
  .catch(e => console.log('Senden FEHLER:', e.message));
