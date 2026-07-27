const { JsonDB } = require('./src/db');
const path = require('path');
const os = require('os');
const db = new JsonDB(path.join(os.homedir(), '.discord-klon', 'db.json'));
const user = db.getUserByUsername('lol');
if (!user) { console.log('User nicht gefunden'); process.exit(1); }
db.updateUser(user.id, { emailVerified: false, email: 'duprekejo@gmail.com' });
console.log('emailVerified gesetzt auf: false');
console.log('Email: ' + db.getUserByUsername('lol').email);
