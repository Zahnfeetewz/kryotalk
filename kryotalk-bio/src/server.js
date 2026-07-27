const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const STATIC_DIR = path.join(__dirname, '..', 'static');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadDB(name) {
  const fp = path.join(DATA_DIR, name + '.json');
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  return {};
}
function saveDB(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'kryotalk-secret-' + Date.now(), resave: false, saveUninitialized: false, cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(STATIC_DIR));

const upload = multer({ storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)) }), limits: { fileSize: 10 * 1024 * 1024 } });

function auth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Nicht eingeloggt' });
}

function getUser(username) {
  const users = loadDB('users');
  return users[username] || null;
}

function getUsers() {
  return loadDB('users');
}

function saveUser(username, user) {
  const users = loadDB('users');
  users[username] = user;
  saveDB('users', users);
}

function getProfile(username) {
  const profiles = loadDB('profiles');
  return profiles[username] || { username, bio: '', links: [], effects: {}, avatar: '', layout: 'default', theme: { bg: '#0a0a0a', cardBg: '#1a1a2e', accent: '#7c3aed', textColor: '#ffffff' } };
}

function saveProfile(username, profile) {
  const profiles = loadDB('profiles');
  profiles[username] = profile;
  saveDB('profiles', profiles);
}

function getStats() {
  return loadDB('stats') || { totalUsers: 0, totalViews: 0, totalUploads: 0, totalLinks: 0 };
}
function saveStats(stats) {
  saveDB('stats', stats);
}

app.get('/api/stats', (req, res) => {
  const users = getUsers();
  const profiles = loadDB('profiles');
  let totalLinks = 0;
  let totalViews = 0;
  Object.values(profiles).forEach(p => { totalLinks += (p.links || []).length; totalViews += p.views || 0; });
  res.json({ users: Object.keys(users).length, views: totalViews, links: totalLinks, uploads: Object.keys(fs.readdirSync(UPLOAD_DIR)).length });
});

app.post('/api/register', (req, res) => {
  let { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort nötig' });
  username = username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Username: 3-30 Zeichen, nur a-z, 0-9, . _ -' });
  if (getUser(username)) return res.status(400).json({ error: 'Username bereits vergeben' });
  const hash = bcrypt.hashSync(password, 10);
  const token = uuidv4();
  saveUser(username, { username, password: hash, email: email || '', createdAt: Date.now(), token, premium: false });
  saveProfile(username, { username, bio: '', links: [], effects: {}, avatar: '', layout: 'default', theme: { bg: '#0a0a0a', cardBg: '#1a1a2e', accent: '#7c3aed', textColor: '#ffffff' }, views: 0, verified: false });
  const stats = getStats(); stats.totalUsers++; saveStats(stats);
  req.session.userId = username;
  res.json({ ok: true, username });
});

app.post('/api/login', (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Felder ausfüllen' });
  username = username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const user = getUser(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Falsche Zugangsdaten' });
  req.session.userId = username;
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', auth, (req, res) => {
  const profile = getProfile(req.session.userId);
  const user = getUser(req.session.userId);
  res.json({ username: req.session.userId, email: user.email, premium: user.premium, profile });
});

app.put('/api/profile', auth, (req, res) => {
  const profile = getProfile(req.session.userId);
  const { bio, theme, layout, effects } = req.body;
  if (bio !== undefined) profile.bio = bio;
  if (theme) profile.theme = { ...profile.theme, ...theme };
  if (layout) profile.layout = layout;
  if (effects) profile.effects = { ...profile.effects, ...effects };
  saveProfile(req.session.userId, profile);
  res.json({ ok: true, profile });
});

app.post('/api/links', auth, (req, res) => {
  const profile = getProfile(req.session.userId);
  const { title, url, icon } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'Titel und URL nötig' });
  const link = { id: uuidv4(), title, url, icon: icon || '', clicks: 0, enabled: true };
  profile.links.push(link);
  saveProfile(req.session.userId, profile);
  res.json({ ok: true, link });
});

app.put('/api/links/:id', auth, (req, res) => {
  const profile = getProfile(req.session.userId);
  const link = profile.links.find(l => l.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'Link nicht gefunden' });
  Object.assign(link, req.body);
  saveProfile(req.session.userId, profile);
  res.json({ ok: true, link });
});

app.delete('/api/links/:id', auth, (req, res) => {
  const profile = getProfile(req.session.userId);
  profile.links = profile.links.filter(l => l.id !== req.params.id);
  saveProfile(req.session.userId, profile);
  res.json({ ok: true });
});

app.post('/api/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const profile = getProfile(req.session.userId);
  profile.avatar = '/uploads/' + req.file.filename;
  saveProfile(req.session.userId, profile);
  res.json({ ok: true, avatar: profile.avatar });
});

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const stats = getStats(); stats.totalUploads = (stats.totalUploads || 0) + 1; saveStats(stats);
  res.json({ ok: true, url: '/uploads/' + req.file.filename, filename: req.file.originalname, size: req.file.size });
});

app.get('/api/profile/:username', (req, res) => {
  const profile = getProfile(req.params.username);
  if (!profile || !profile.username) return res.status(404).json({ error: 'Profil nicht gefunden' });
  profile.views = (profile.views || 0) + 1;
  saveProfile(req.params.username, profile);
  const stats = getStats(); stats.totalViews = (stats.totalViews || 0) + 1; saveStats(stats);
  res.json({ ...profile, links: profile.links || [] });
});

app.get('/api/check/:username', (req, res) => {
  const exists = !!getUser(req.params.username.toLowerCase());
  res.json({ available: !exists });
});

app.get('/api/link/:username/:linkId/click', (req, res) => {
  const profile = getProfile(req.params.username);
  const link = (profile.links || []).find(l => l.id === req.params.linkId);
  if (link) { link.clicks = (link.clicks || 0) + 1; saveProfile(req.params.username, profile); }
  if (link) return res.redirect(link.url);
  res.status(404).send('Link nicht gefunden');
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(STATIC_DIR, 'dashboard.html')));
app.get('/register', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

app.get('/{0,}', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: 'Not found' });
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(STATIC_DIR, 'profile.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log('kryotalk running on port ' + PORT));
