const { JsonDB } = require('./src/db');
const path = require('path');
const os = require('os');
const db = new JsonDB(path.join(os.homedir(), '.discord-klon', 'db.json'));

const user = db.getUserByUsername('lol');
if (!user) { console.log('lol nicht gefunden'); process.exit(1); }

const code = String(Math.floor(100000 + Math.random() * 900000));
db.updateUser(user.id, {
  email: 'duprekejo@gmail.com',
  emailVerified: false,
  verificationCode: code,
  verificationExpires: Date.now() + 5 * 60 * 1000,
  is_admin: true,
  is_owner: true
});

console.log('Code:', code);
console.log('Admin/Owner wiederhergestellt');
console.log('Email: duprekejo@gmail.com');
