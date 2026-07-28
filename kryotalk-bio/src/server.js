const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

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

// ============= OSINT =============
const OSINT_PLATFORMS = [
  { name:'GitHub', check: u=>`https://github.com/${u}`, icon:'🐙' },
  { name:'GitLab', check: u=>`https://gitlab.com/${u}`, icon:'🦊' },
  { name:'Twitter / X', check: u=>`https://x.com/${u}`, icon:'🐦' },
  { name:'Instagram', check: u=>`https://www.instagram.com/${u}/`, icon:'📸' },
  { name:'TikTok', check: u=>`https://www.tiktok.com/@${u}`, icon:'🎵' },
  { name:'YouTube', check: u=>`https://www.youtube.com/@${u}`, icon:'🎬' },
  { name:'Reddit', check: u=>`https://www.reddit.com/user/${u}`, icon:'🔴' },
  { name:'Twitch', check: u=>`https://www.twitch.tv/${u}`, icon:'🟣' },
  { name:'Discord', check: u=>`https://discord.com/${u}`, icon:'💬' },
  { name:'Pinterest', check: u=>`https://www.pinterest.com/${u}/`, icon:'📌' },
  { name:'LinkedIn', check: u=>`https://www.linkedin.com/in/${u}`, icon:'💼' },
  { name:'Steam', check: u=>`https://steamcommunity.com/id/${u}`, icon:'🎮' },
  { name:'Spotify', check: u=>`https://open.spotify.com/user/${u}`, icon:'🎧' },
  { name:'SoundCloud', check: u=>`https://soundcloud.com/${u}`, icon:'🔊' },
  { name:'Medium', check: u=>`https://medium.com/@${u}`, icon:'📝' },
  { name:'DevTo', check: u=>`https://dev.to/${u}`, icon:'👨‍💻' },
  { name:'CodePen', check: u=>`https://codepen.io/${u}`, icon:'✏️' },
  { name:'npm', check: u=>`https://www.npmjs.com/~${u}`, icon:'📦' },
  { name:'Docker Hub', check: u=>`https://hub.docker.com/u/${u}`, icon:'🐳' },
  { name:'Keybase', check: u=>`https://keybase.io/${u}`, icon:'🔑' },
  { name:'About.me', check: u=>`https://about.me/${u}`, icon:'👤' },
  { name:'Gravatar', check: u=>`https://gravatar.com/${u}`, icon:'🖼️' },
  { name:'Last.fm', check: u=>`https://www.last.fm/user/${u}`, icon:'🎵' },
  { name:'Flickr', check: u=>`https://www.flickr.com/people/${u}`, icon:'📷' },
  { name:'DeviantArt', check: u=>`https://www.deviantart.com/${u}`, icon:'🎨' },
  { name:'Vimeo', check: u=>`https://vimeo.com/${u}`, icon:'🎥' },
  { name:'Behance', check: u=>`https://www.behance.net/${u}`, icon:'🖼️' },
  { name:'Patreon', check: u=>`https://www.patreon.com/${u}`, icon:'💰' },
  { name:'Telegram', check: u=>`https://t.me/${u}`, icon:'✈️' },
  { name:'VK', check: u=>`https://vk.com/${u}`, icon:'🌐' },
  { name:'HackerNews', check: u=>`https://news.ycombinator.com/user?id=${u}`, icon:'🔶' },
  { name:'ProductHunt', check: u=>`https://www.producthunt.com/@${u}`, icon:'🚀' },
  { name:'Replit', check: u=>`https://replit.com/@${u}`, icon:'💻' },
  { name:'GitBook', check: u=>`https://gitbook.io/${u}`, icon:'📚' },
  { name:'Notion', check: u=>`https://${u}.notion.site`, icon:'📋' },
  { name:'Quora', check: u=>`https://www.quora.com/profile/${u}`, icon:'❓' },
  { name:'Roblox', check: u=>`https://www.roblox.com/user.aspx?username=${u}`, icon:'🎲' },
  { name:'MyAnimeList', check: u=>`https://myanimelist.net/profile/${u}`, icon:'🎌' },
  { name:'Dailymotion', check: u=>`https://www.dailymotion.com/${u}`, icon:'📺' },
  { name:'Fiverr', check: u=>`https://www.fiverr.com/${u}`, icon:'💵' },
  { name:'Freelancer', check: u=>`https://www.freelancer.com/u/${u}`, icon:'🏗️' },
  { name:'Blogger', check: u=>`https://${u}.blogspot.com`, icon:'📰' },
  { name:'WordPress.com', check: u=>`https://${u}.wordpress.com`, icon:'📰' },
  { name:'Tumblr', check: u=>`https://${u}.tumblr.com`, icon:'🌐' },
  { name:'Cash App', check: u=>`https://cash.app/$${u}`, icon:'💵' },
  { name:'Linktree', check: u=>`https://linktr.ee/${u}`, icon:'🌳' },
  { name:'Twitch', check: u=>`https://m.twitch.tv/${u}/about`, icon:'🟣' },
  { name:'OSU!', check: u=>`https://osu.ppy.sh/users/${u}`, icon:'⭕' },
  { name:'Minecraft', check: u=>`https://namemc.com/profile/${u}`, icon:'⛏️' },
  { name:'LeetCode', check: u=>`https://leetcode.com/${u}`, icon:'🧩' },
  { name:'HackerRank', check: u=>`https://www.hackerrank.com/${u}`, icon:'🏆' },
];

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeout = opts.timeout || 5000;
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...(opts.headers || {}) }, signal: AbortSignal?.timeout?.(timeout) }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

app.post('/api/osint/username', auth, async (req, res) => {
  const { username } = req.body;
  if (!username || username.length < 2) return res.status(400).json({ error: 'Username nötig (mind. 2 Zeichen)' });
  const u = username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const results = [];
  const checks = OSINT_PLATFORMS.map(async (p) => {
    try {
      const url = p.check(u);
      const r = await httpGet(url, { timeout: 4000 });
      const found = r.status === 200 && !r.body.includes('not found') && !r.body.includes('This page') && !r.body.includes('404');
      results.push({ platform: p.name, icon: p.icon, url, status: found ? 'found' : 'not_found', httpCode: r.status });
    } catch {
      results.push({ platform: p.name, icon: p.icon, url: p.check(u), status: 'error', httpCode: 0 });
    }
  });
  await Promise.allSettled(checks);
  const found = results.filter(r => r.status === 'found').length;
  res.json({ username: u, total: results.length, found, results: results.sort((a, b) => (a.status === 'found' ? -1 : 1) - (b.status === 'found' ? -1 : 1)) });
});

app.post('/api/osint/email', auth, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ungültige E-Mail' });
  const domain = email.split('@')[1];
  const local = email.split('@')[0];
  const result = { email, domain, local, valid: true, flags: [] };
  const disposables = ['guerrillamail.com','tempmail.com','throwaway.email','temp-mail.org','10minutemail.com','mailinator.com','yopmail.com','guerrillamailblock.com','sharklasers.com','grr.la','dispostable.com','trashmail.com','maildrop.cc','fakeinbox.com','mohmal.com','getnada.com','emailondeck.com','33mail.com','mytemp.email','harakirimail.com','tmail.io','tmpmail.net','discard.email','burnermail.io','tutanota.com','protonmail.com','guerrillamail.com','mailnesia.com','discardmail.com','tempail.com','tempr.email','tmpmail.org'];
  if (disposables.some(d => domain.toLowerCase() === d)) { result.flags.push('Disposable Email'); result.disposable = true; }
  try {
    const mx = await dns.resolveMx(domain);
    result.mxRecords = mx.sort((a, b) => a.priority - b.priority).map(m => ({ exchange: m.exchange, priority: m.priority }));
    result.mxValid = result.mxRecords.length > 0;
  } catch { result.mxRecords = []; result.mxValid = false; result.flags.push('Keine MX Records'); }
  const sha = crypto.createHash('sha256').update(local.trim().toLowerCase()).digest('hex');
  result.gravatarHash = sha;
  result.gravatarUrl = `https://www.gravatar.com/avatar/${sha}?d=404`;
  try {
    const g = await httpGet(result.gravatarUrl, { timeout: 3000 });
    result.hasGravatar = g.status === 200;
  } catch { result.hasGravatar = false; }
  const providers = { 'gmail.com': 'Google Gmail', 'outlook.com': 'Microsoft Outlook', 'hotmail.com': 'Microsoft Hotmail', 'yahoo.com': 'Yahoo Mail', 'protonmail.com': 'ProtonMail', 'proton.me': 'ProtonMail', 'icloud.com': 'Apple iCloud', 'aol.com': 'AOL Mail', 'zoho.com': 'Zoho Mail', 'yandex.com': 'Yandex Mail', 'mail.com': 'MAIL.COM', 'gmx.com': 'GMX', 'web.de': 'WEB.DE', 'tutanota.com': 'Tutanota', 'tuta.io': 'Tutanota', 'hey.com': 'HEY', 'fastmail.com': 'FastMail' };
  result.provider = providers[domain.toLowerCase()] || domain;
  try {
    const rep = await httpGet(`https://emailrep.io/${encodeURIComponent(email)}`, { timeout: 5000, headers: { Accept: 'application/json' } });
    if (rep.status === 200) { const d = JSON.parse(rep.body); result.reputation = { score: d.score, summary: d.summary, details: d.details }; }
  } catch {}
  res.json(result);
});

app.post('/api/osint/ip', auth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP-Adresse nötig' });
  const ipClean = ip.trim();
  try {
    const r = await httpGet(`http://ip-api.com/json/${ipClean}?fields=66846719`, { timeout: 5000 });
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      if (d.status === 'success') {
        let reverseDns = '';
        try { const names = await dns.reverse(ipClean); reverseDns = names[0] || ''; } catch {}
        return res.json({ ip: ipClean, country: d.country, countryISO: d.countryCode, region: d.regionName, city: d.city, zip: d.zip, lat: d.lat, lon: d.lon, timezone: d.timezone, isp: d.isp, org: d.org, as: d.as, asname: d.asname, reverse: reverseDns, mobile: d.mobile, proxy: d.proxy, hosting: d.hosting });
      }
    }
  } catch {}
  try {
    const r2 = await httpGet(`https://ipinfo.io/${ipClean}/json`, { timeout: 5000 });
    if (r2.status === 200) { const d = JSON.parse(r2.body); return res.json({ ip: ipClean, country: d.country, region: d.region, city: d.city, zip: d.postal, lat: parseFloat(d.loc?.split(',')[0]) || 0, lon: parseFloat(d.loc?.split(',')[1]) || 0, timezone: d.timezone, isp: d.org, hostname: d.hostname }); }
  } catch {}
  res.status(500).json({ error: 'IP-Lookup fehlgeschlagen' });
});

app.post('/api/osint/domain', auth, async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain nötig' });
  const d = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const result = { domain: d, dns: {}, headers: {}, technologies: [] };
  const recordTypes = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA'];
  for (const t of recordTypes) {
    try {
      if (t === 'A') result.dns.A = (await dns.resolve4(d)).slice(0, 5);
      else if (t === 'AAAA') result.dns.AAAA = (await dns.resolve6(d)).slice(0, 5);
      else if (t === 'MX') result.dns.MX = (await dns.resolveMx(d)).map(m => ({ exchange: m.exchange, priority: m.priority })).slice(0, 10);
      else if (t === 'NS') result.dns.NS = (await dns.resolveNs(d)).slice(0, 5);
      else if (t === 'TXT') result.dns.TXT = (await dns.resolveTxt(d)).map(r => r.join('')).slice(0, 10);
      else if (t === 'CNAME') result.dns.CNAME = (await dns.resolveCname(d)).slice(0, 5);
      else if (t === 'SOA') result.dns.SOA = (await dns.resolveSoa(d));
    } catch {}
  }
  try {
    const r = await httpGet(`https://${d}`, { timeout: 5000 });
    result.statusCode = r.status;
    result.headers = { server: r.headers['server'] || '', contentType: r.headers['content-type'] || '', poweredBy: r.headers['x-powered-by'] || '', strictTransport: r.headers['strict-transport-security'] ? true : false, contentSecurity: r.headers['content-security-policy'] ? true : false, xFrame: r.headers['x-frame-options'] || '', xContentType: r.headers['x-content-type-options'] || '' };
    const body = r.body.toLowerCase();
    const techChecks = { 'wordpress': 'WordPress', 'wp-content': 'WordPress', 'drupal': 'Drupal', 'joomla': 'Joomla', 'shopify': 'Shopify', 'wix': 'Wix', 'squarespace': 'Squarespace', 'react': 'React', 'vue': 'Vue.js', 'angular': 'Angular', 'next': 'Next.js', 'nuxt': 'Nuxt.js', 'laravel': 'Laravel', 'django': 'Django', 'flask': 'Flask', 'rails': 'Ruby on Rails', 'spring': 'Spring', 'asp.net': 'ASP.NET', 'cloudflare': 'Cloudflare', 'nginx': 'Nginx', 'apache': 'Apache', 'vercel': 'Vercel', 'netlify': 'Netlify', 'firebase': 'Firebase', 'google-analytics': 'Google Analytics', 'gtag': 'Google Tag Manager', 'jquery': 'jQuery', 'bootstrap': 'Bootstrap', 'tailwind': 'Tailwind CSS', 'font-awesome': 'Font Awesome', 'recaptcha': 'reCAPTCHA', 'stripe': 'Stripe', 'paypal': 'PayPal' };
    for (const [k, v] of Object.entries(techChecks)) { if (body.includes(k)) result.technologies.push(v); }
    result.technologies = [...new Set(result.technologies)];
  } catch {}
  try {
    const { X509Certificate } = require('crypto');
    const tls = require('tls');
    await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: d, port: 443, servername: d, rejectUnauthorized: false, timeout: 5000 }, () => {
        const cert = socket.getPeerCertificate();
        if (cert && cert.subject) {
          result.ssl = { subject: cert.subject.CN || '', issuer: cert.issuer?.CN || '', validFrom: cert.valid_from, validTo: cert.valid_to, serialNumber: cert.serialNumber };
        }
        socket.end(); resolve();
      });
      socket.on('error', () => resolve());
      socket.on('timeout', () => { socket.destroy(); resolve(); });
    });
  } catch {}
  res.json(result);
});

app.post('/api/osint/phone', auth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefonnummer nötig' });
  const raw = phone.replace(/[\s\-\(\)]/g, '');
  const result = { raw, e164: '', country: '', carrier: '', lineType: '', format: { national: '', international: '', valid: false } };
  const countryPatterns = [
    { code: '+1', country: 'USA / Kanada', flag: '🇺🇸' }, { code: '+44', country: 'Vereinigtes Königreich', flag: '🇬🇧' },
    { code: '+49', country: 'Deutschland', flag: '🇩🇪' }, { code: '+43', country: 'Österreich', flag: '🇦🇹' },
    { code: '+41', country: 'Schweiz', flag: '🇨🇭' }, { code: '+33', country: 'Frankreich', flag: '🇫🇷' },
    { code: '+34', country: 'Spanien', flag: '🇪🇸' }, { code: '+39', country: 'Italien', flag: '🇮🇹' },
    { code: '+31', country: 'Niederlande', flag: '🇳🇱' }, { code: '+48', country: 'Polen', flag: '🇵🇱' },
    { code: '+46', country: 'Schweden', flag: '🇸🇪' }, { code: '+47', country: 'Norwegen', flag: '🇳🇴' },
    { code: '+45', country: 'Dänemark', flag: '🇩🇰' }, { code: '+358', country: 'Finnland', flag: '🇫🇮' },
    { code: '+353', country: 'Irland', flag: '🇮🇪' }, { code: '+352', country: 'Luxemburg', flag: '🇱🇺' },
    { code: '+61', country: 'Australien', flag: '🇦🇺' }, { code: '+64', country: 'Neuseeland', flag: '🇳🇿' },
    { code: '+81', country: 'Japan', flag: '🇯🇵' }, { code: '+82', country: 'Südkorea', flag: '🇰🇷' },
    { code: '+86', country: 'China', flag: '🇨🇳' }, { code: '+91', country: 'Indien', flag: '🇮🇳' },
    { code: '+55', country: 'Brasilien', flag: '🇧🇷' }, { code: '+52', country: 'Mexiko', flag: '🇲🇽' },
    { code: '+7', country: 'Russland', flag: '🇷🇺' }, { code: '+380', country: 'Ukraine', flag: '🇺🇦' },
    { code: '+381', country: 'Serbien', flag: '🇷🇸' }, { code: '+385', country: 'Kroatien', flag: '🇭🇷' },
    { code: '+386', country: 'Slowenien', flag: '🇸🇮' }, { code: '+420', country: 'Tschechien', flag: '🇨🇿' },
    { code: '+421', country: 'Slowakei', flag: '🇸🇰' }, { code: '+36', country: 'Ungarn', flag: '🇭🇺' },
    { code: '+40', country: 'Rumänien', flag: '🇷🇴' }, { code: '+359', country: 'Bulgarien', flag: '🇧🇬' },
    { code: '+90', country: 'Türkei', flag: '🇹🇷' }, { code: '+27', country: 'Südafrika', flag: '🇿🇦' },
    { code: '+234', country: 'Nigeria', flag: '🇳🇬' }, { code: '+254', country: 'Kenia', flag: '🇰🇪' },
    { code: '+971', country: 'VAE', flag: '🇦🇪' }, { code: '+966', country: 'Saudi-Arabien', flag: '🇸🇦' },
    { code: '+972', country: 'Israel', flag: '🇮🇱' }, { code: '+65', country: 'Singapur', flag: '🇸🇬' },
    { code: '+60', country: 'Malaysia', flag: '🇲🇾' }, { code: '+63', country: 'Philippinen', flag: '🇵🇭' },
    { code: '+66', country: 'Thailand', flag: '🇹🇭' }, { code: '+84', country: 'Vietnam', flag: '🇻🇳' },
    { code: '+62', country: 'Indonesien', flag: '🇮🇩' }, { code: '+54', country: 'Argentinien', flag: '🇦🇷' },
    { code: '+56', country: 'Chile', flag: '🇨🇱' }, { code: '+57', country: 'Kolumbien', flag: '🇨🇴' },
    { code: '+58', country: 'Venezuela', flag: '🇻🇪' }, { code: '+51', country: 'Peru', flag: '🇵🇪' },
  ];
  let detected = null;
  const num = raw.startsWith('+') ? raw : (raw.startsWith('00') ? '+' + raw.substring(2) : raw);
  for (const p of countryPatterns) { if (num.startsWith(p.code)) { detected = p; break; } }
  if (detected) { result.country = detected.country; result.flag = detected.flag; result.e164 = num; }
  else { result.e164 = num.startsWith('+') ? num : '+' + num; result.country = 'Unbekannt'; }
  const digits = num.replace(/\D/g, '');
  result.valid = digits.length >= 7 && digits.length <= 15;
  result.format = { international: result.e164, national: result.e164.replace(detected?.code || '', '').replace(/^0+/, ''), valid: result.valid };
  result.lineType = digits.length <= 8 ? 'Festnetz' : 'Mobil';
  const carrierMap = { 'deutsche telekom': '+49', 'vodafone': '+49', 'o2': '+49', 'telenor': '+47', 'telia': '+46', 'swisscom': '+41', 'orange': '+33', 'sfr': '+33', 'tim': '+39', 'movistar': '+34' };
  result.carrier = 'Nicht ermittelbar';
  res.json(result);
});

app.post('/api/osint/password', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Passwort nötig' });
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);
  let breachCount = 0;
  try {
    const r = await httpGet(`https://api.pwnedpasswords.com/range/${prefix}`, { timeout: 5000 });
    if (r.status === 200) {
      const lines = r.body.split('\n');
      for (const line of lines) {
        const [hash, count] = line.split(':');
        if (hash.trim() === suffix) { breachCount = parseInt(count.trim(), 10); break; }
      }
    }
  } catch {}
  let score = 0;
  const checks = { length: password.length >= 8, uppercase: /[A-Z]/.test(password), lowercase: /[a-z]/.test(password), numbers: /[0-9]/.test(password), symbols: /[^A-Za-z0-9]/.test(password), long: password.length >= 12, veryLong: password.length >= 16 };
  Object.values(checks).forEach(v => { if (v) score++; });
  const entropy = Math.log2(Math.pow(new Set(password).size, password.length));
  let strength = 'Sehr schwach';
  if (score >= 7 && entropy > 80) strength = 'Sehr stark';
  else if (score >= 5 && entropy > 60) strength = 'Stark';
  else if (score >= 4 && entropy > 40) strength = 'Mittel';
  else if (score >= 3) strength = 'Schwach';
  const timeToCrack = entropy < 30 ? 'Sofort' : entropy < 50 ? 'Minuten' : entropy < 60 ? 'Stunden' : entropy < 70 ? 'Tage' : entropy < 80 ? 'Jahre' : entropy < 100 ? 'Jahrtausende' : 'Milliarden Jahre';
  res.json({ breachCount, breached: breachCount > 0, strength, score, entropy: Math.round(entropy), checks, timeToCrack });
});

app.post('/api/osint/exif', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const exifData = {};
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xE1) {
          const size = buf.readUInt16BE(offset + 2);
          const segment = buf.slice(offset + 4, offset + 2 + size);
          if (segment.slice(0, 6).toString('ascii') === 'Exif\0\0') {
            const tiff = segment.slice(6);
            const bigEndian = tiff[0] === 0x4D;
            const ifdOffset = tiff.readUInt32BE(4);
            const readShort = (off) => bigEndian ? tiff.readUInt16BE(off) : tiff.readUInt16LE(off);
            const readLong = (off) => bigEndian ? tiff.readUInt32BE(off) : tiff.readUInt32LE(off);
            const readIFD = (ifd) => {
              const count = readShort(ifd);
              for (let i = 0; i < count; i++) {
                const entry = ifd + 2 + (i * 12);
                const tag = readShort(entry);
                const type = readShort(entry + 2);
                const numVal = readLong(entry + 4);
                let val;
                if (type === 2) { const strOff = numVal > 4 ? readLong(entry + 8) : entry + 8; const strEnd = tiff.indexOf(0, strOff); val = tiff.slice(strOff, strEnd > 0 ? strEnd : strOff + 200).toString('ascii'); }
                else if (type === 3) val = readShort(entry + 8);
                else if (type === 4) val = readLong(entry + 8);
                else if (type === 5) { const ratOff = readLong(entry + 8); val = readLong(ratOff) / readLong(ratOff + 4); }
                else val = numVal;
                const tagNames = { 0x010F: 'CameraMake', 0x0110: 'CameraModel', 0x0112: 'Orientation', 0x011A: 'XResolution', 0x011B: 'YResolution', 0x0131: 'Software', 0x0132: 'DateTime', 0x0213: 'YCbCrPositioning', 0x8769: 'ExifIFD', 0x8825: 'GPSIFD', 0xA005: 'InteropIFD', 0x829A: 'ExposureTime', 0x829D: 'FNumber', 0x8827: 'ISO', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0x920A: 'FocalLength', 0xA002: 'PixelXDimension', 0xA003: 'PixelYDimension', 0xA405: 'FocalLengthIn35mmFilm', 0xA430: 'CameraOwnerName', 0xA431: 'BodySerialNumber', 0xA432: 'LensInfo', 0xA433: 'LensMake', 0xA434: 'LensModel' };
                if (tagNames[tag]) exifData[tagNames[tag]] = val;
                if (tag === 0x8769) readIFD(readLong(entry + 8));
                if (tag === 0x8825) {
                  const gpsOff = readLong(entry + 8);
                  const gpsCount = readShort(gpsOff);
                  const gpsData = {};
                  for (let j = 0; j < gpsCount; j++) {
                    const ge = gpsOff + 2 + (j * 12);
                    const gTag = readShort(ge); const gType = readShort(ge + 2); const gVal = readLong(ge + 4);
                    const gpsTags = { 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude', 7: 'GPSTimeStamp', 29: 'GPSDateStamp' };
                    if (gpsTags[gTag]) {
                      if (gType === 5) { const rOff = gVal; gpsData[gpsTags[gTag]] = readLong(rOff) / readLong(rOff + 4); }
                      else if (gTag === 2 || gTag === 4) { const rOff = gVal; gpsData[gpsTags[gTag]] = `${readLong(rOff)}/${readLong(rOff + 4)}° ${readLong(rOff + 8)}/${readLong(rOff + 12)}' ${readLong(rOff + 16)}/${readLong(rOff + 20)}"`; }
                      else gpsData[gpsTags[gTag]] = gType === 2 ? tiff.slice(gVal > 4 ? gVal : ge + 8, tiff.indexOf(0, gVal > 4 ? gVal : ge + 8)).toString('ascii') : gVal;
                    }
                  }
                  if (Object.keys(gpsData).length) exifData.GPS = gpsData;
                }
              }
            };
            readIFD(ifdOffset);
          }
          break;
        }
        const size = buf.readUInt16BE(offset + 2);
        offset += 2 + size;
      }
    }
    fs.unlinkSync(req.file.path);
    res.json({ filename: req.file.originalname, size: req.file.size, exif: exifData, hasExif: Object.keys(exifData).length > 0 });
  } catch (e) { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); res.json({ filename: req.file.originalname, size: req.file.size, exif: {}, hasExif: false, error: e.message }); }
});

app.get('/api/osint/dorks', auth, (req, res) => {
  const { target } = req.query;
  const t = target || 'example';
  const dorks = [
    { category: '📧 E-Mail Adressen', icon: '📧', queries: [
      { label: 'E-Mails mit Domain', dork: `"@${t}.com" email`, desc: 'Finde E-Mail-Adressen mit einer bestimmten Domain' },
      { label: 'E-Mail in Dateien', dork: `"${t}" filetype:csv OR filetype:xlsx OR filetype:pdf email`, desc: 'E-Mails in Dokumenten' },
      { label: 'Kontakt-Seiten', dork: `site:${t}.com intext:"email" OR intext:"kontakt" OR intext:"@${t}"`, desc: 'Kontaktinformationen auf Websites' },
    ]},
    { category: '🔐 Login-Seiten', icon: '🔐', queries: [
      { label: 'Login Pages', dork: `inurl:login OR inurl:signin OR inurl:admin site:${t}.com`, desc: 'Alle Login-Seiten einer Domain' },
      { label: 'Admin Panels', dork: `inurl:admin OR inurl:dashboard OR inurl:panel site:${t}.com`, desc: 'Admin-Bereiche' },
      { label: 'phpMyAdmin', dork: `inurl:phpmyadmin site:${t}.com`, desc: 'Datenbank-Admin' },
    ]},
    { category: '📄 Dateien & Dokumente', icon: '📄', queries: [
      { label: 'PDF-Dokumente', dork: `site:${t}.com filetype:pdf`, desc: 'Alle PDFs einer Domain' },
      { label: 'Excel-Dateien', dork: `site:${t}.com filetype:xlsx OR filetype:xls`, desc: 'Tabellenkalkulationen' },
      { label: 'Word-Dokumente', dork: `site:${t}.com filetype:docx OR filetype:doc`, desc: 'Word-Dokumente' },
      { label: 'Konfigurationsdateien', dork: `site:${t}.com filetype:env OR filetype:conf OR filetype:yml OR filetype:json`, desc: 'Config-Dateien (potentiell gefährlich)' },
      { label: 'Log-Dateien', dork: `site:${t}.com filetype:log`, desc: 'Server-Logs' },
      { label: 'Backup-Dateien', dork: `site:${t}.com filetype:bak OR filetype:backup OR filetype:sql OR filetype:zip`, desc: 'Backups und Datenbank-Dumps' },
      { label: 'HTpasswd', dork: `site:${t}.com inurl:.htpasswd`, desc: 'Passwort-Dateien' },
      { label: '.git Ordner', dork: `site:${t}.com inurl:.git`, desc: 'Exponierte Git-Repos' },
    ]},
    { category: '🌐 Subdomains & Infrastruktur', icon: '🌐', queries: [
      { label: 'Subdomains', dork: `site:*.${t}.com -www`, desc: 'Alle Subdomains' },
      { label: 'Exponierte Dateien', dork: `site:${t}.com inurl:wp-config OR inurl:.env OR inurl:config`, desc: 'Konfigurationsdateien' },
      { label: 'API Endpunkte', dork: `site:${t}.com inurl:api OR inurl:v1 OR inurl:v2 OR inurl:graphql`, desc: 'API-Endpoints' },
    ]},
    { category: '👤 Social Media & Personen', icon: '👤', queries: [
      { label: 'Social Profiles', dork: `"${t}" site:twitter.com OR site:linkedin.com OR site:facebook.com OR site:instagram.com`, desc: 'Social-Media-Profile' },
      { label: 'Pastebin Leaks', dork: `"${t}" site:pastebin.com OR site:ghostbin.co OR site:hastebin.com`, desc: 'Pastebin-Einträge' },
      { label: 'Forum Posts', dork: `"${t}" site:reddit.com OR site:stackoverflow.com OR site:quora.com`, desc: 'Foren-Beiträge' },
      { label: 'GitHub Leaks', dork: `"${t}" site:github.com`, desc: 'GitHub-Erwähnungen' },
      { label: 'Job Profiles', dork: `"${t}" site:linkedin.com/in OR site:xing.com OR site:glassdoor.com`, desc: 'Berufliche Profile' },
    ]},
    { category: '⚠️ Sicherheit', icon: '⚠️', queries: [
      { label: 'Error Pages', dork: `site:${t}.com intext:"error" OR intext:"exception" OR intext:"stack trace"`, desc: 'Fehlerseiten mit Infos' },
      { label: 'Publicly Exposed Docs', dork: `site:${t}.com intext:"confidential" OR intext:"internal" OR intext:"restricted"`, desc: 'Interne Dokumente' },
      { label: 'Pastebin Dumps', dork: `site:pastebin.com "${t}" password OR secret OR key OR token`, desc: 'Leaked Credentials' },
      { label: 'S3 Buckets', dork: `site:s3.amazonaws.com "${t}"`, desc: 'AWS S3 Buckets' },
    ]},
  ];
  res.json({ target: t, dorks });
});

app.get('/api/osint/crypto/:address', auth, async (req, res) => {
  const addr = req.params.address;
  const result = { address: addr, chain: 'unknown', balance: 0, transactions: 0 };
  if (/^(1|3|bc1)/.test(addr)) {
    result.chain = 'Bitcoin';
    try {
      const r = await httpGet(`https://blockchain.info/rawaddr/${addr}?limit=1`, { timeout: 8000 });
      if (r.status === 200) { const d = JSON.parse(r.body); result.balance = (d.final_balance / 1e8).toFixed(8); result.transactions = d.n_tx; result.received = (d.total_received / 1e8).toFixed(8); result.sent = (d.total_sent / 1e8).toFixed(8); }
    } catch {}
  } else if (/^0x/.test(addr)) {
    result.chain = 'Ethereum';
    try {
      const r = await httpGet(`https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest&apikey=YourApiKeyToken`, { timeout: 8000 });
      if (r.status === 200) { const d = JSON.parse(r.body); if (d.status === '1') result.balance = (parseInt(d.result) / 1e18).toFixed(8); }
    } catch {}
  }
  res.json(result);
});

app.get('/api/osint/wifi', auth, async (req, res) => {
  const { bssid } = req.query;
  if (!bssid) return res.status(400).json({ error: 'BSSID nötig' });
  const mac = bssid.replace(/[:\-\.]/g, '').toUpperCase();
  const oui = mac.substring(0, 6);
  const ouiDb = {
    '001A2B': 'Ai-Net', '001B63': 'Apple', '001E58': 'D-Link', '00226B': 'Apple', '002312': 'Apple',
    '002608': 'Apple', '0C725C': 'TP-Link', '18E829': 'Ubiquiti', '20E52A': 'Netgear', '24050F': 'Ubiquiti',
    '30B5C2': 'TP-Link', '3497F6': 'ASUSTek', '40A677': 'Amazon', '44E9DD': 'Amazon', '50C7BF': 'TP-Link',
    '546009': 'HP', '5811AA': 'Apple', '6038E0': 'Belkin', '60A44C': 'ASUSTek', '60E327': 'TP-Link',
    '6466B3': 'D-Link', '687251': 'Ubiquiti', '6C4B90': 'Zyxel', '704D7B': 'ASUSTek', '7440BE': 'LG',
    '788A20': 'Ubiquiti', '7C8BCA': 'TP-Link', '802AA8': 'Ubiquiti', '841B5E': 'Netgear', '88DC96': 'EnGenius',
    '907240': 'Apple', '94103E': 'Belkin', '98DEC3': 'Apple', 'A00460': 'Netgear', 'A020A6': 'Arista',
    'A06391': 'Netgear', 'A42B8C': 'TP-Link', 'A85E84': 'ASUSTek', 'AC2205': 'TP-Link', 'AC84C6': 'TP-Link',
    'B04E26': 'TP-Link', 'B07F9B': 'Ubiquiti', 'B09FBA': 'Apple', 'B4FB84': 'Ubiquiti', 'B827EB': 'Raspberry',
    'B8EE65': 'Netgear', 'C025E9': 'TP-Link', 'C04A00': 'TP-Link', 'C47154': 'TP-Link', 'C4E984': 'TP-Link',
    'C83A35': 'Tenda', 'CC40D0': 'D-Link', 'D021F9': 'Ubiquiti', 'D46E5C': 'TP-Link', 'D807B6': 'TP-Link',
    'D850E6': 'ASUSTek', 'DC9FDB': 'Ubiquiti', 'E063DA': 'Ubiquiti', 'E4F004': 'Google', 'E894F6': 'TP-Link',
    'EC086B': 'TP-Link', 'ECAAA0': 'HG', 'F09FC2': 'Ubiquiti', 'F46D04': 'ASUSTek', 'F4E2C6': 'Ubiquiti',
    'F81A67': 'TP-Link', 'F8D111': 'TP-Link', 'FCECDA': 'Ubiquiti', '00146C': 'Netgear', '3CD92B': 'HP',
  };
  const vendor = ouiDb[oui] || 'Unbekannt (OUI: ' + oui + ')';
  res.json({ bssid: mac, oui, vendor, formatted: mac.match(/.{2}/g).join(':') });
});

app.post('/api/osint/cryptocurrency', auth, async (req, res) => {
  const { address, chain } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse nötig' });
  let detected = chain || 'unknown';
  if (!chain) {
    if (/^(1|3|bc1)/.test(address)) detected = 'bitcoin';
    else if (/^0x/.test(address)) detected = 'ethereum';
    else if (/^T/.test(address)) detected = 'tron';
    else if (/^r/.test(address)) detected = 'ripple';
    else if (/^ltc/.test(address)) detected = 'litecoin';
  }
  const result = { address, chain: detected, balance: '0', txCount: 0 };
  if (detected === 'bitcoin') {
    try {
      const r = await httpGet(`https://blockchain.info/rawaddr/${address}?limit=0`, { timeout: 8000 });
      if (r.status === 200) { const d = JSON.parse(r.body); result.balance = (d.final_balance / 1e8).toFixed(8); result.txCount = d.n_tx; result.received = (d.total_received / 1e8).toFixed(8); }
    } catch {}
  } else if (detected === 'ethereum') {
    try {
      const r = await httpGet(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`, { timeout: 8000 });
      if (r.status === 200) { const d = JSON.parse(r.body); if (d.status === '1') result.balance = (parseInt(d.result) / 1e18).toFixed(8); }
    } catch {}
  }
  res.json(result);
});

app.get('/osint', (req, res) => res.sendFile(path.join(STATIC_DIR, 'osint.html')));
app.get('/osint/app', auth, (req, res) => res.sendFile(path.join(STATIC_DIR, 'osint-app.html')));

// ============= END OSINT =============

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: 'Not found' });
  if (req.path.includes('.')) return res.status(404).send('Not found');
  if (req.path === '/' || req.path === '/dashboard' || req.path === '/register' || req.path.startsWith('/embed/') || req.path === '/osint' || req.path === '/osint/app') return next();
  res.sendFile(path.join(STATIC_DIR, 'profile.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log('kryotalk v2 running on port ' + PORT));
