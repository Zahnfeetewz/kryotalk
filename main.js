const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { JsonDB } = require('./src/db');
const auth = require('./src/auth');
const rarity = require('./src/rarity');
const { createServer } = require('./src/server');

let mainWindow;
let db;
let uploadsDir;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#1e1f22',
    title: 'Kryotalk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
}

app.whenReady().then(() => {
  const sharedDataDir = path.join(os.homedir(), '.discord-klon');
  if (!fs.existsSync(sharedDataDir)) fs.mkdirSync(sharedDataDir, { recursive: true });
  uploadsDir = path.join(sharedDataDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  db = new JsonDB(path.join(sharedDataDir, 'db.json'));
  createWindow();
  const server = createServer(db, uploadsDir, getLocalIP);

  session.defaultSession.setDisplayMediaRequestHandler(async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    if (sources.length > 0) {
      return { video: sources[0], audio: 'loopback' };
    }
    return null;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'camera', 'display-capture', 'geolocation', 'notifications'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (process.argv.includes('--tunnel')) {
    const { spawn } = require('child_process');
    const cfBin = path.join(__dirname, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
    console.log('\nStarte Cloudflare Quick Tunnel...\n');
    const tunnel = spawn(cfBin, ['tunnel', '--url', 'http://localhost:3000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    function scanOutput(data) {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        console.log('');
        console.log('================================================');
        console.log('  TUNNEL AKTIV!');
        console.log('  Oeffne diese URL im Browser:');
        console.log('  ' + match[0]);
        console.log('  Jeder auf der Welt kann jetzt zugreifen!');
        console.log('================================================');
        console.log('');
      }
    }
    tunnel.stdout.on('data', scanOutput);
    tunnel.stderr.on('data', scanOutput);
    tunnel.on('error', function (err) { console.error('Tunnel-Fehler:', err.message); });
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Helpers ──
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv6' && !net.internal) return net.address;
    }
  }
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── E-Mail Transporter (nodemailer) ──
let emailTransporter = null;
function getTransporter() {
  if (emailTransporter) return emailTransporter;
  try {
    const cfgPath = path.join(os.homedir(), '.discord-klon', 'email-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      emailTransporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: !!cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, tls: { rejectUnauthorized: false } });
      return emailTransporter;
    } else {
      console.log('[E-Mail] Keine email-config.json gefunden unter ' + cfgPath);
    }
  } catch (e) { console.log('[E-Mail] Fehler beim Laden der Config: ' + e.message); }
  return null;
}

async function sendVerificationEmail(email, code, username) {
  const transport = getTransporter();
  if (!transport) {
    console.log('\n========================================');
    console.log('  E-MAIL VERIFIZIERUNG (Dev-Modus)');
    console.log('  An: ' + email);
    console.log('  Benutzer: ' + username);
    console.log('  Code: ' + code);
    console.log('========================================\n');
    return { ok: true, devMode: true, reason: 'Kein SMTP-Transporter verfuegbar' };
  }
  try {
    console.log('[E-Mail] Sende Verifizierung an ' + email + '...');
    const info = await transport.sendMail({
      from: '"KryoTalk" <kryotalk.verify@gmail.com>',
      to: email,
      subject: 'E-Mail-Adresse verifizieren',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#2b2d31;border-radius:12px;color:#fff">' +
        '<h2 style="color:#5865f2;text-align:center">E-Mail verifizieren</h2>' +
        '<p>Hallo <b>' + username + '</b>,</p>' +
        '<p>Verifiziere deine E-Mail-Adresse mit dem folgenden Code:</p>' +
        '<div style="text-align:center;margin:24px 0"><span style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#5865f2;padding:12px 24px;border-radius:8px;display:inline-block">' + code + '</span></div>' +
        '<p style="font-size:13px;color:#b5bac1">Dieser Code ist 5 Minuten g&uuml;ltig.</p>' +
        '</div>'
    });
    console.log('[E-Mail] Gesendet! MessageId: ' + info.messageId);
    return { ok: true, devMode: false };
  } catch (e) {
    console.log('\n[E-Mail FEHLER] ' + e.message);
    console.log('[E-Mail] Stack: ' + e.stack);
    console.log('[E-Mail] Code fuer ' + email + ': ' + code + '\n');
    return { ok: true, devMode: true, reason: e.message };
  }
}

// ── IPC: Auth ──
ipcMain.handle('auth:getIP', async () => getLocalIP());

ipcMain.handle('auth:register', async (event, { username, password, email }) => {
  const result = auth.register(db, { username, password, email });
  if (result.ok) {
    db.updateUser(result.user.id, { lastIP: getLocalIP() });
    const user = db.getUserById(result.user.id);
    console.log('[Register] User erstellt: ' + username + ' | Email: ' + email + ' | verificationCode: ' + (user ? user.verificationCode : 'N/A'));
    if (user && user.verificationCode) {
      const mailResult = await sendVerificationEmail(email, user.verificationCode, username);
      console.log('[Register] MailResult: devMode=' + mailResult.devMode + (mailResult.reason ? ' reason=' + mailResult.reason : ''));
      result.devMode = mailResult.devMode;
      result.devCode = user.verificationCode;
      result.mailError = mailResult.reason || null;
    }
  }
  return result;
});

ipcMain.handle('auth:login', async (event, { username, password }) => {
  const result = auth.login(db, { username, password });
  if (result.ok) db.updateUser(result.user.id, { lastIP: getLocalIP() });
  return result;
});

ipcMain.handle('auth:checkUsername', async (event, { username }) => {
  const format = rarity.validateUsernameFormat(username);
  if (!format.ok) return { ok: false, error: format.reason };
  const taken = !!db.getUserByUsername(username);
  const tier = rarity.getRarityForLength(username.length);
  const availability = rarity.checkAvailability(username, db.getAllUsernames());
  return { ok: true, taken, rarityKey: tier.key, rarityLabel: tier.label, remaining: availability.remaining };
});

ipcMain.handle('auth:getUserPublic', async (event, { username }) => {
  const user = db.getUserByUsername(username);
  if (!user) return { ok: false };
  return { ok: true, user: auth.publicUser(user) };
});

// ── IPC: E-Mail Verifizierung ──
ipcMain.handle('email:verify', async (event, { userId, code }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (user.emailVerified) return { ok: true, error: 'Bereits verifiziert.' };
  if (!user.verificationCode) return { ok: false, error: 'Kein Verifizierungscode vorhanden.' };
  if (user.verificationExpires && Date.now() > user.verificationExpires) return { ok: false, error: 'Code abgelaufen. Bitte neuen Code anfordern.' };
  if (user.verificationCode !== code) return { ok: false, error: 'Falscher Code.' };
  db.updateUser(userId, { emailVerified: true, verificationCode: null, verificationExpires: null });
  return { ok: true };
});

ipcMain.handle('email:resend', async (event, { userId }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (user.emailVerified) return { ok: false, error: 'Bereits verifiziert.' };
  const newCode = auth.generateVerificationCode();
  db.updateUser(userId, { verificationCode: newCode, verificationExpires: Date.now() + 5 * 60 * 1000 });
  const mailResult = await sendVerificationEmail(user.email, newCode, user.username);
  console.log('[Resend] MailResult: devMode=' + mailResult.devMode + (mailResult.reason ? ' reason=' + mailResult.reason : ''));
  return { ok: true, devMode: mailResult.devMode, code: newCode, mailError: mailResult.reason || null };
});

ipcMain.handle('email:change', async (event, { userId, newEmail }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { ok: false, error: 'Gültige E-Mail-Adresse erforderlich.' };
  const existing = db.getUserByEmail(newEmail);
  if (existing && existing.id !== userId) return { ok: false, error: 'Diese E-Mail-Adresse wird bereits verwendet.' };
  const newCode = auth.generateVerificationCode();
  db.updateUser(userId, { email: newEmail, emailVerified: false, verificationCode: newCode, verificationExpires: Date.now() + 5 * 60 * 1000 });
  const mailResult = await sendVerificationEmail(newEmail, newCode, user.username);
  return { ok: true, devMode: mailResult.devMode, code: mailResult.devMode ? newCode : undefined };
});

// ── IPC: Passwort vergessen ──
ipcMain.handle('auth:forgotPassword', async (event, { username }) => {
  if (!username) return { ok: false, error: 'Benutzername erforderlich.' };
  const user = db.getUserByUsername(username);
  if (!user || !user.email) return { ok: false, error: 'Kein Konto mit dieser E-Mail gefunden.' };
  const code = auth.generateVerificationCode();
  db.updateUser(user.id, { resetCode: code, resetCodeExpires: Date.now() + 10 * 60 * 1000 });
  const mailResult = await sendVerificationEmail(user.email, code, user.username);
  const masked = user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
  return { ok: true, email: masked, devMode: mailResult.devMode, code: mailResult.devMode ? code : undefined };
});

ipcMain.handle('auth:resendResetCode', async (event, { username }) => {
  if (!username) return { ok: false, error: 'Benutzername erforderlich.' };
  const user = db.getUserByUsername(username);
  if (!user || !user.email) return { ok: false, error: 'Kein Konto gefunden.' };
  const code = auth.generateVerificationCode();
  db.updateUser(user.id, { resetCode: code, resetCodeExpires: Date.now() + 10 * 60 * 1000 });
  const mailResult = await sendVerificationEmail(user.email, code, user.username);
  return { ok: true, devMode: mailResult.devMode, code: mailResult.devMode ? code : undefined };
});

ipcMain.handle('auth:resetPassword', async (event, { username, code, newPassword }) => {
  if (!username || !code || !newPassword) return { ok: false, error: 'Alle Felder erforderlich.' };
  if (newPassword.length < 1) return { ok: false, error: 'Passwort darf nicht leer sein.' };
  const user = db.getUserByUsername(username);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!user.resetCode) return { ok: false, error: 'Kein Reset-Code vorhanden. Bitte neuen anfordern.' };
  if (user.resetCodeExpires && Date.now() > user.resetCodeExpires) return { ok: false, error: 'Code abgelaufen. Bitte neuen Code anfordern.' };
  if (user.resetCode !== code) return { ok: false, error: 'Falscher Code.' };
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.changePassword(user.id, newHash);
  db.updateUser(user.id, { resetCode: null, resetCodeExpires: null });
  return { ok: true };
});

// ── IPC: Profil ──
ipcMain.handle('profile:pickImage', async (event, { kind }) => {
  const filters = kind === 'banner'
    ? [{ name: 'Bilder & GIFs', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    : [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }];
  const result = await dialog.showOpenDialog(mainWindow, { title: kind === 'banner' ? 'Banner' : 'Avatar', properties: ['openFile'], filters });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath).toLowerCase();
  const destName = `${kind}_${Date.now()}${ext}`;
  const destPath = path.join(uploadsDir, destName);
  fs.copyFileSync(srcPath, destPath);
  return { ok: true, path: destPath, isGif: ext === '.gif' };
});

ipcMain.handle('profile:pickBackground', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Hintergrund', properties: ['openFile'], filters: [{ name: 'Alles', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }] });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath).toLowerCase();
  const destPath = path.join(uploadsDir, `background_${Date.now()}${ext}`);
  fs.copyFileSync(srcPath, destPath);
  let kind = 'image';
  if (ext === '.gif') kind = 'gif';
  else if (ext === '.mp4' || ext === '.webm') kind = 'video';
  return { ok: true, path: destPath, kind };
});

ipcMain.handle('upload:file', async (event, { filePath, name }) => {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false };
  const ext = path.extname(name || filePath).toLowerCase() || '.png';
  const destName = `upload_${Date.now()}${ext}`;
  const destPath = path.join(uploadsDir, destName);
  fs.copyFileSync(filePath, destPath);
  return { ok: true, path: destPath };
});

ipcMain.handle('profile:update', async (event, { userId, patch }) => {
  const updated = db.updateUser(userId, patch);
  if (!updated) return { ok: false, error: 'Nutzer nicht gefunden.' };
  return { ok: true, user: auth.publicUser(updated) };
});

ipcMain.handle('profile:get', async (event, { userId }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  return { ok: true, user: auth.publicUser(user) };
});

// ── IPC: Admin Panel (Passwort-geschützt) ──
ipcMain.handle('admin:login', async (event, { password }) => {
  const stored = db.getAdminPassword();
  if (!stored) return { ok: true, firstTime: true };
  if (bcrypt.compareSync(password, stored)) return { ok: true };
  return { ok: false, error: 'Falsches Passwort.' };
});

ipcMain.handle('admin:setPassword', async (event, { password }) => {
  db.setAdminPassword(bcrypt.hashSync(password, 10));
  return { ok: true };
});

ipcMain.handle('admin:getAllUsers', async () => {
  return db.getAllUsers().map((u) => auth.publicUser(u));
});

ipcMain.handle('admin:deleteUser', async (event, { userId, callerId }) => {
  const caller = db.getUserById(callerId);
  if (!caller) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (userId === callerId) {
    db.deleteUser(userId);
    return { ok: true };
  }
  if (!caller.is_owner) return { ok: false, error: 'Nur der Owner kann andere Nutzer loeschen.' };
  const target = db.getUserById(userId);
  if (target && target.is_owner) return { ok: false, error: 'Der Owner kann nicht geloescht werden.' };
  db.deleteUser(userId);
  return { ok: true };
});

ipcMain.handle('admin:toggleAdmin', async (event, { userId, callerId }) => {
  const caller = db.getUserById(callerId);
  if (!caller || !caller.is_owner) return { ok: false, error: 'Nur der Owner kann Admin-Rechte aendern.' };
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (user.is_owner) return { ok: false, error: 'Der Owner kann nicht degradiert werden.' };
  const updated = db.updateUser(userId, { is_admin: !user.is_admin });
  return { ok: true, user: auth.publicUser(updated) };
});

// ── IPC: Server ──
    ipcMain.handle('server:create', async (event, { name, userId }) => {
      return db.createServer(name, userId);
    });

    ipcMain.handle('server:update', async (event, { serverId, name, icon, description }) => {
      const data = db._read();
      const s = data.servers.find(s => s.id === serverId);
      if (s) {
        if (name !== undefined) s.name = name;
        if (icon !== undefined) s.icon = icon;
        if (description !== undefined) s.description = description;
      }
      db._write(data);
      return s;
    });

ipcMain.handle('server:getAll', async () => {
  return db.getAllServers();
});

ipcMain.handle('server:getForUser', async (event, { userId }) => {
  return db.getServersForUser(userId);
});

ipcMain.handle('server:getById', async (event, { serverId }) => {
  const server = db.getServerById(serverId);
  if (!server) return { ok: false };
  return { ok: true, server };
});

ipcMain.handle('server:join', async (event, { serverId, userId }) => {
  return db.joinServer(serverId, userId);
});

ipcMain.handle('server:joinByCode', async (event, { code, userId }) => {
  const server = db.joinServerByCode(code, userId);
  if (!server) return { ok: false, error: 'Invite-Code ungueltig oder Server nicht gefunden.' };
  return { ok: true, server };
});

ipcMain.handle('server:regenerateInviteCode', async (event, { serverId }) => {
  const newCode = db.regenerateInviteCode(serverId);
  if (!newCode) return { ok: false };
  return { ok: true, code: newCode };
});

ipcMain.handle('server:leave', async (event, { serverId, userId }) => {
  db.leaveServer(serverId, userId);
  return { ok: true };
});

ipcMain.handle('server:delete', async (event, { serverId, userId }) => {
  const server = db.getServerById(serverId);
  if (!server || server.ownerId !== userId) return { ok: false, error: 'Kein Recht.' };
  db.deleteServer(serverId);
  return { ok: true };
});

ipcMain.handle('server:addChannel', async (event, { serverId, name, type }) => {
  return db.addChannel(serverId, name, type || 'text');
});

ipcMain.handle('server:deleteChannel', async (event, { serverId, channelId }) => {
  db.deleteChannel(serverId, channelId);
  return { ok: true };
});

ipcMain.handle('server:invite', async (event, { serverId, username }) => {
  const user = db.getUserByUsername(username);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  db.joinServer(serverId, user.id);
  return { ok: true };
});

// ── IPC: Rollen ──
ipcMain.handle('server:addRole', async (event, { serverId, name, color }) => {
  return db.addRole(serverId, name, color);
});

ipcMain.handle('server:deleteRole', async (event, { serverId, roleId }) => {
  db.deleteRole(serverId, roleId);
  return { ok: true };
});

ipcMain.handle('server:assignRole', async (event, { serverId, roleId, userId }) => {
  db.assignRole(serverId, roleId, userId);
  return { ok: true };
});

ipcMain.handle('server:removeRole', async (event, { serverId, roleId, userId }) => {
  db.removeRole(serverId, roleId, userId);
  return { ok: true };
});

ipcMain.handle('server:updateRole', async (event, { serverId, roleId, patch }) => {
  const role = db.updateRole(serverId, roleId, patch || {});
  return role ? { ok: true, role } : { ok: false };
});

// ── IPC: Nachrichten ──
ipcMain.handle('messages:get', async (event, { channelId }) => {
  return db.getMessages(channelId);
});

ipcMain.handle('messages:search', async (event, { query, channelId, serverId }) => {
  if (!query) return [];
  const q = query.toLowerCase();
  const data = db._read();
  let msgs = data.messages || [];
  if (channelId) msgs = msgs.filter(m => m.channelId === channelId);
  if (serverId) msgs = msgs.filter(m => m.serverId === serverId);
  return msgs.filter(m => (m.content || '').toLowerCase().includes(q)).slice(-50);
});

ipcMain.handle('messages:send', async (event, { channelId, serverId, authorId, content, attachments }) => {
  return db.sendMessage(channelId, serverId, authorId, content, attachments);
});

ipcMain.handle('messages:delete', async (event, { msgId }) => {
  db.deleteMessage(msgId);
  return { ok: true };
});

ipcMain.handle('messages:react', async (event, { msgId, emoji, userId }) => {
  return db.addReaction(msgId, emoji, userId);
});

ipcMain.handle('messages:edit', async (event, { msgId, content }) => {
  return db.editMessage(msgId, content);
});

ipcMain.handle('messages:pin', async (event, { msgId }) => {
  db.pinMessage(msgId);
  return { ok: true };
});

// ── IPC: DMs ──
ipcMain.handle('dm:getOrCreate', async (event, { userId1, userId2 }) => {
  return db.getOrCreateDM(userId1, userId2);
});

ipcMain.handle('dm:getAll', async (event, { userId }) => {
  return db.getDMs(userId);
});

ipcMain.handle('dm:getMessages', async (event, { dmId }) => {
  return db.getDMMessages(dmId);
});

ipcMain.handle('dm:send', async (event, { dmId, authorId, content, attachments }) => {
  return db.sendDM(dmId, authorId, content, attachments);
});

// ── IPC: Friends ──
ipcMain.handle('friends:getList', async (event, { userId }) => {
  return db.getFriends(userId).map(u => auth.publicUser(u));
});

ipcMain.handle('friends:getRequests', async (event, { userId }) => {
  const reqs = db.getFriendRequests(userId);
  return reqs.map(r => {
    const from = db.getUserById(r.fromId);
    const to = db.getUserById(r.toId);
    return { ...r, fromUser: from ? auth.publicUser(from) : null, toUser: to ? auth.publicUser(to) : null };
  });
});

ipcMain.handle('friends:sendRequest', async (event, { fromId, toId }) => {
  const req = db.sendFriendRequest(fromId, toId);
  if (!req) return { ok: false, error: 'Anfrage bereits vorhanden oder Nutzer nicht gefunden.' };
  return { ok: true, request: req };
});

ipcMain.handle('friends:acceptRequest', async (event, { reqId }) => {
  const req = db.acceptFriendRequest(reqId);
  if (!req) return { ok: false };
  return { ok: true };
});

ipcMain.handle('friends:declineRequest', async (event, { reqId }) => {
  db.declineFriendRequest(reqId);
  return { ok: true };
});

ipcMain.handle('friends:remove', async (event, { userId, friendId }) => {
  db.removeFriend(userId, friendId);
  return { ok: true };
});

// ── IPC: File Upload for Messages ──
ipcMain.handle('messages:pickFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Datei auswaehlen',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac'] },
      { name: 'Dateien', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const attachments = [];
  for (const srcPath of result.filePaths) {
    const ext = path.extname(srcPath).toLowerCase();
    const baseName = path.basename(srcPath);
    const destName = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(uploadsDir, destName);
    fs.copyFileSync(srcPath, destPath);
    const stat = fs.statSync(srcPath);
    let kind = 'file';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) kind = 'image';
    else if (['.mp4', '.webm', '.mov'].includes(ext)) kind = 'video';
    else if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) kind = 'audio';
    attachments.push({ path: destPath, name: baseName, kind, size: stat.size });
  }
  return { ok: true, attachments };
});

ipcMain.handle('file:saveAs', async (event, { filePath }) => {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Speichern unter',
    defaultPath: path.basename(filePath),
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.copyFileSync(filePath, result.filePath);
  return { ok: true };
});

// ── IPC: Login-Medien ──
ipcMain.handle('login:getMedia', async () => { return db._read().loginMedia || null; });

ipcMain.handle('login:setMedia', async (event, { mediaPath, mediaKind }) => {
  const data = db._read();
  data.loginMedia = { path: mediaPath, kind: mediaKind };
  db._write(data);
  return { ok: true };
});

ipcMain.handle('login:clearMedia', async () => {
  const data = db._read();
  delete data.loginMedia;
  db._write(data);
  return { ok: true };
});

// ── IPC: Users ──
ipcMain.handle('users:getById', async (event, { userId }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false };
  return { ok: true, user: auth.publicUser(user) };
});

ipcMain.handle('users:getByIds', async (event, { userIds }) => {
  const users = db.getUsersByIds(userIds);
  return users.map(u => auth.publicUser(u));
});

// ── IPC: Server Members ──
ipcMain.handle('server:getMembers', async (event, { serverId }) => {
  const server = db.getServerById(serverId);
  if (!server) return [];
  return server.members.map(id => {
    const user = db.getUserById(id);
    return user ? auth.publicUser(user) : null;
  }).filter(Boolean);
});

// ── IPC: Auth Password ──
ipcMain.handle('auth:changePassword', async (event, { userId, oldPassword, newPassword }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!bcrypt.compareSync(oldPassword, user.passwordHash)) return { ok: false, error: 'Altes Passwort ist falsch.' };
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.changePassword(userId, newHash);
  return { ok: true };
});

// ── IPC: Zwei-Faktor-Authentifizierung (TOTP) ──
ipcMain.handle('2fa:setup', async (event, { userId }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (user.twoFactorEnabled) return { ok: false, error: '2FA ist bereits aktiviert.' };

  const totp = new OTPAuth.TOTP({
    issuer: 'Kryotalk',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 256, margin: 2 });

  db.updateUser(userId, {
    twoFactorPending: true,
    twoFactorSecret: totp.secret.base32,
    twoFactorUserId: userId,
  });

  return { ok: true, secret: totp.secret.base32, qrCode: qrDataUrl, otpauthUri: uri };
});

ipcMain.handle('2fa:verify', async (event, { userId, code }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!user.twoFactorPending) return { ok: false, error: 'Kein 2FA-Setup aktiv.' };

  const totp = new OTPAuth.TOTP({
    issuer: 'Kryotalk',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
  });

  const delta = totp.validate({ token: code, window: 2 });
  if (delta === null) return { ok: false, error: 'Ungueltiger Code. Bitte nochmal versuchen.' };

  db.updateUser(userId, {
    twoFactorEnabled: true,
    twoFactorPending: false,
  });

  return { ok: true };
});

ipcMain.handle('2fa:disable', async (event, { userId, code }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!user.twoFactorEnabled) return { ok: false, error: '2FA ist nicht aktiviert.' };

  const totp = new OTPAuth.TOTP({
    issuer: 'Kryotalk',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
  });

  const delta = totp.validate({ token: code, window: 2 });
  if (delta === null) return { ok: false, error: 'Ungueltiger Code.' };

  db.updateUser(userId, {
    twoFactorEnabled: false,
    twoFactorPending: false,
    twoFactorSecret: null,
  });

  return { ok: true };
});

ipcMain.handle('2fa:checkOnLogin', async (event, { userId, code }) => {
  const user = db.getUserById(userId);
  if (!user) return { ok: false, error: 'Nutzer nicht gefunden.' };
  if (!user.twoFactorEnabled || !user.twoFactorSecret) return { ok: true };

  const totp = new OTPAuth.TOTP({
    issuer: 'Kryotalk',
    label: user.username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
  });

  const delta = totp.validate({ token: code, window: 2 });
  if (delta === null) return { ok: false, error: 'Falscher 2FA-Code.' };

  return { ok: true };
});
