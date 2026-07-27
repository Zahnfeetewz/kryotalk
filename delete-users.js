const { JsonDB } = require('./src/db');
const path = require('path');
const os = require('os');
const db = new JsonDB(path.join(os.homedir(), '.discord-klon', 'db.json'));

const users = db.getAllUsers();
console.log('Alle User:', users.map(u => `${u.username} (id: ${u.id})`));

for (const u of users) {
  if (u.username === 'lol' || u.username === 'ok') {
    db.deleteUser(u.id);
    console.log(`Geloescht: ${u.username}`);
  }
}

console.log('Verbleibende User:', db.getAllUsers().map(u => u.username));
