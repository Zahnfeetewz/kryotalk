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

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function loadDB(name) { const fp = path.join(DATA_DIR, name + '.json'); return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : {}; }
function saveDB(name, data) { fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2)); }

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'kryotalk-v2-' + Date.now(), resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(STATIC_DIR));

const upload = multer({ storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)) }), limits: { fileSize: 50 * 1024 * 1024 } });

function auth(req, res, next) { if (req.session?.userId) return next(); res.status(401).json({ error: 'Nicht eingeloggt' }); }
function getUser(u) { return loadDB('users')[u] || null; }
function getUsers() { return loadDB('users'); }
function saveUser(u, d) { const db = loadDB('users'); db[u] = d; saveDB('users', db); }
function getProfile(u) { const p = loadDB('profiles')[u]; return p || defaultProfile(u); }
function saveProfile(u, p) { const db = loadDB('profiles'); db[u] = p; saveDB('profiles', db); }
function defaultProfile(u) {
  return { username: u, bio: '', links: [], socials: [], avatar: '', background: '', bgType: 'color', bgValue: '#0a0a0a',
    layout: 'centered', theme: { bg: '#0a0a0a', cardBg: '#18181b', cardBorder: '#27272a', accent: '#7c3aed', accent2: '#a78bfa', textColor: '#ffffff', textSecondary: '#a1a1aa', linkStyle: 'glass', borderRadius: '14px', fontFamily: 'Inter' },
    effects: { rain: false, snow: false, stars: false, particles: false, matrix: false, fireflies: false, confetti: false },
    avatarEffects: { glow: true, pulse: false, rotate: false, border: true },
    bioAnimation: 'none', customCSS: '', customCursor: '', musicUrl: '', musicAutoplay: false,
    seo: { title: '', description: '', ogImage: '' },
    verified: false, premium: false, views: 0, clicks: 0, createdAt: Date.now(), visibility: 'public', passwordProtect: false, profilePassword: '' };
}
function getStats() { return loadDB('stats') || { totalUsers: 0, totalViews: 0, totalUploads: 0 }; }
function saveStats(s) { saveDB('stats', s); }

const THEMES = {
  midnight: { bg: '#0a0a0a', cardBg: '#18181b', cardBorder: '#27272a', accent: '#7c3aed', accent2: '#a78bfa', textColor: '#ffffff', textSecondary: '#a1a1aa' },
  ocean: { bg: '#0c1222', cardBg: '#111b2e', cardBorder: '#1e2d4a', accent: '#0ea5e9', accent2: '#38bdf8', textColor: '#f0f9ff', textSecondary: '#7dd3fc' },
  sunset: { bg: '#1a0a0a', cardBg: '#2a1111', cardBorder: '#3d1c1c', accent: '#f97316', accent2: '#fb923c', textColor: '#fff7ed', textSecondary: '#fdba74' },
  forest: { bg: '#0a1a0a', cardBg: '#112a11', cardBorder: '#1c3d1c', accent: '#22c55e', accent2: '#4ade80', textColor: '#f0fdf4', textSecondary: '#86efac' },
  neon: { bg: '#0a0a14', cardBg: '#12121f', cardBorder: '#1e1e3a', accent: '#e879f9', accent2: '#f0abfc', textColor: '#faf5ff', textSecondary: '#d8b4fe' },
  fire: { bg: '#140a0a', cardBg: '#201111', cardBorder: '#3a1c1c', accent: '#ef4444', accent2: '#f87171', textColor: '#fef2f2', textSecondary: '#fca5a5' },
  arctic: { bg: '#f0f4f8', cardBg: '#ffffff', cardBorder: '#e2e8f0', accent: '#0284c7', accent2: '#38bdf8', textColor: '#0f172a', textSecondary: '#64748b' },
  sakura: { bg: '#1a0f14', cardBg: '#2a1520', cardBorder: '#3d2030', accent: '#ec4899', accent2: '#f472b6', textColor: '#fdf2f8', textSecondary: '#f9a8d4' },
  vaporwave: { bg: '#120428', cardBg: '#1a0838', cardBorder: '#2d1058', accent: '#a855f7', accent2: '#c084fc', textColor: '#faf5ff', textSecondary: '#d8b4fe' },
  midnightBlue: { bg: '#020617', cardBg: '#0f172a', cardBorder: '#1e293b', accent: '#6366f1', accent2: '#818cf8', textColor: '#f8fafc', textSecondary: '#94a3b8' }
};

const LINK_ICONS = { github: '🐙', twitter: '🐦', instagram: '📷', youtube: '🎬', tiktok: '🎵', discord: '💬', twitch: '🎮', spotify: '🎧', linkedin: '💼', email: '📧', website: '🌐', telegram: '✈️', snapchat: '👻', reddit: '🔴', pinterest: '📌', facebook: '👤', twitch: '🟣', tiktok: '🎵', soundcloud: '🔊', github: '🐙' };

app.get('/api/stats', (req, res) => {
  const users = getUsers(); const profiles = loadDB('profiles');
  let totalLinks = 0, totalViews = 0;
  Object.values(profiles).forEach(p => { totalLinks += (p.links || []).length; totalViews += p.views || 0; });
  res.json({ users: Object.keys(users).length, views: totalViews, links: totalLinks, uploads: Object.keys(fs.readdirSync(UPLOAD_DIR)).length });
});

app.post('/api/register', (req, res) => {
  let { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort nötig' });
  username = username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Username: 3-30 Zeichen (a-z, 0-9, . _ -)' });
  if (getUser(username)) return res.status(400).json({ error: 'Username bereits vergeben' });
  saveUser(username, { username, password: bcrypt.hashSync(password, 10), email: email || '', createdAt: Date.now(), premium: false });
  saveProfile(username, defaultProfile(username));
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
  const user = getUser(req.session.userId);
  const profile = getProfile(req.session.userId);
  res.json({ username: req.session.userId, email: user.email, premium: user.premium, profile });
});

app.put('/api/profile', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  const allowed = ['bio','background','bgType','bgValue','layout','theme','effects','avatarEffects','bioAnimation','customCSS','customCursor','musicUrl','musicAutoplay','seo','visibility','passwordProtect','profilePassword','socials'];
  allowed.forEach(k => { if (req.body[k] !== undefined) p[k] = req.body[k]; });
  if (req.body.theme) p.theme = { ...p.theme, ...req.body.theme };
  if (req.body.effects) p.effects = { ...p.effects, ...req.body.effects };
  if (req.body.avatarEffects) p.avatarEffects = { ...p.avatarEffects, ...req.body.avatarEffects };
  if (req.body.seo) p.seo = { ...p.seo, ...req.body.seo };
  saveProfile(req.session.userId, p);
  res.json({ ok: true, profile: p });
});

app.put('/api/profile/bulk', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  Object.assign(p, req.body);
  saveProfile(req.session.userId, p);
  res.json({ ok: true, profile: p });
});

app.post('/api/links', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  const { title, url, icon, color, newTab } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'Titel und URL nötig' });
  p.links.push({ id: uuidv4(), title, url, icon: icon || '🔗', color: color || '', newTab: newTab !== false, clicks: 0, enabled: true, order: p.links.length });
  saveProfile(req.session.userId, p);
  res.json({ ok: true, links: p.links });
});

app.put('/api/links/:id', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  const link = p.links.find(l => l.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'Link nicht gefunden' });
  Object.assign(link, req.body);
  saveProfile(req.session.userId, p);
  res.json({ ok: true, link });
});

app.delete('/api/links/:id', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  p.links = p.links.filter(l => l.id !== req.params.id);
  saveProfile(req.session.userId, p);
  res.json({ ok: true });
});

app.put('/api/links-order', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'Ungültig' });
  const map = {};
  p.links.forEach(l => map[l.id] = l);
  p.links = orderedIds.filter(id => map[id]).map((id, i) => { map[id].order = i; return map[id]; });
  saveProfile(req.session.userId, p);
  res.json({ ok: true });
});

app.post('/api/socials', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  const { platform, url } = req.body;
  if (!platform || !url) return res.status(400).json({ error: 'Platform und URL nötig' });
  p.socials = p.socials || [];
  const existing = p.socials.find(s => s.platform === platform);
  if (existing) existing.url = url;
  else p.socials.push({ platform, url });
  saveProfile(req.session.userId, p);
  res.json({ ok: true, socials: p.socials });
});

app.delete('/api/socials/:platform', auth, (req, res) => {
  const p = getProfile(req.session.userId);
  p.socials = (p.socials || []).filter(s => s.platform !== req.params.platform);
  saveProfile(req.session.userId, p);
  res.json({ ok: true });
});

app.post('/api/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const p = getProfile(req.session.userId);
  p.avatar = '/uploads/' + req.file.filename;
  saveProfile(req.session.userId, p);
  res.json({ ok: true, avatar: p.avatar });
});

app.post('/api/background', auth, upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const p = getProfile(req.session.userId);
  p.background = '/uploads/' + req.file.filename;
  saveProfile(req.session.userId, p);
  res.json({ ok: true, background: p.background });
});

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const stats = getStats(); stats.totalUploads = (stats.totalUploads || 0) + 1; saveStats(stats);
  res.json({ ok: true, url: '/uploads/' + req.file.filename, filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

app.get('/api/profile/:username', (req, res) => {
  const p = getProfile(req.params.username);
  if (!p || !p.username) return res.status(404).json({ error: 'Profil nicht gefunden' });
  if (p.visibility === 'hidden') return res.status(404).json({ error: 'Profil nicht gefunden' });
  p.views = (p.views || 0) + 1; p.clicks = (p.clicks || 0);
  saveProfile(req.params.username, p);
  const stats = getStats(); stats.totalViews = (stats.totalViews || 0) + 1; saveStats(stats);
  const { passwordProtect, profilePassword, ...safe } = p;
  res.json(safe);
});

app.get('/api/check/:username', (req, res) => { res.json({ available: !getUser(req.params.username.toLowerCase()) }); });
app.get('/api/themes', (req, res) => { res.json(THEMES); });

app.get('/api/link/:username/:linkId/click', (req, res) => {
  const p = getProfile(req.params.username);
  const link = (p.links || []).find(l => l.id === req.params.linkId);
  if (link) { link.clicks = (link.clicks || 0) + 1; p.clicks = (p.clicks || 0) + 1; saveProfile(req.params.username, p); }
  if (link) return res.redirect(link.url);
  res.status(404).send('Link nicht gefunden');
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(STATIC_DIR, 'dashboard.html')));
app.get('/register', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
app.get('/embed/:username', (req, res) => res.sendFile(path.join(STATIC_DIR, 'embed.html')));

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: 'Not found' });
  if (req.path.includes('.')) return res.status(404).send('Not found');
  if (req.path === '/' || req.path === '/dashboard' || req.path === '/register' || req.path.startsWith('/embed/')) return next();
  res.sendFile(path.join(STATIC_DIR, 'profile.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log('kryotalk v2 running on port ' + PORT));
