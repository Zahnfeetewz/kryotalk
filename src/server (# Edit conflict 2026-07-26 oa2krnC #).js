const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const auth = require('./auth');
const rarity = require('./rarity');

function createServer(db, uploadsDir, getLocalIP) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  function getClientIP(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || '';
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'renderer')));
  app.use('/uploads', express.static(uploadsDir));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

  function classifyFile(ext) {
    ext = ext.toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
    if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';
    return 'file';
  }

  // ── Upload ──
  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.json({ ok: false, error: 'Keine Datei.' });
    const ext = path.extname(req.file.originalname);
    const kind = classifyFile(ext);
    const isGif = ext.toLowerCase() === '.gif';
    res.json({ ok: true, path: req.file.path, name: req.file.originalname, kind, isGif, size: req.file.size });
  });

  app.post('/api/upload-multi', upload.array('files', 10), (req, res) => {
    if (!req.files || req.files.length === 0) return res.json({ ok: false, error: 'Keine Dateien.' });
    const attachments = req.files.map(f => {
      const ext = path.extname(f.originalname);
      return { path: f.path, name: f.originalname, kind: classifyFile(ext), size: f.size };
    });
    res.json({ ok: true, attachments });
  });

  app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Missing path');
    const fileName = path.basename(filePath);
    const resolved = path.join(uploadsDir, fileName);
    if (!fs.existsSync(resolved)) return res.status(404).send('Not found');
    res.download(resolved, fileName);
  });

  // ── E-Mail Transporter (nodemailer) ──
  let emailTransporter = null;
  function getTransporter() {
    if (emailTransporter) return emailTransporter;
    try {
      const cfgPath = require('os').homedir() + '/.discord-klon/email-config.json';
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

  // ── Auth ──
  app.post('/api/auth/getIP', (req, res) => res.json(getLocalIP()));

  app.post('/api/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    const result = auth.register(db, { username, password, email });
    if (result.ok) {
      db.updateUser(result.user.id, { lastIP: getClientIP(req) });
      const user = db.getUserById(result.user.id);
      console.log('[Register] User: ' + username + ' | Email: ' + email + ' | Code: ' + (user ? user.verificationCode : 'N/A'));
      if (user && user.verificationCode) {
        const mailResult = await sendVerificationEmail(email, user.verificationCode, username);
        console.log('[Register] MailResult: devMode=' + mailResult.devMode);
        result.devMode = mailResult.devMode;
        result.devCode = user.verificationCode;
      }
    }
    res.json(result);
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const result = auth.login(db, { username, password });
    if (result.ok) db.updateUser(result.user.id, { lastIP: getClientIP(req) });
    res.json(result);
  });

  app.post('/api/auth/checkUsername', (req, res) => {
    const { username } = req.body;
    const format = rarity.validateUsernameFormat(username);
    if (!format.ok) return res.json({ ok: false, error: format.reason });
    const taken = !!db.getUserByUsername(username);
    const tier = rarity.getRarityForLength(username.length);
    const availability = rarity.checkAvailability(username, db.getAllUsernames());
    res.json({ ok: true, taken, rarityKey: tier.key, rarityLabel: tier.label, remaining: availability.remaining });
  });

  app.post('/api/auth/getUserPublic', (req, res) => {
    const { username } = req.body;
    const user = db.getUserByUsername(username);
    if (!user) return res.json({ ok: false });
    res.json({ ok: true, user: auth.publicUser(user) });
  });

  app.post('/api/auth/changePassword', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!bcrypt.compareSync(oldPassword, user.passwordHash)) return res.json({ ok: false, error: 'Altes Passwort ist falsch.' });
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.changePassword(userId, newHash);
    res.json({ ok: true });
  });

  // ── Passwort vergessen ──
  app.post('/api/auth/forgotPassword', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ ok: false, error: 'Benutzername erforderlich.' });
    const user = db.getUserByUsername(username);
    if (!user || !user.email) return res.json({ ok: false, error: 'Kein Konto mit dieser E-Mail gefunden.' });
    const code = auth.generateVerificationCode();
    db.updateUser(user.id, { resetCode: code, resetCodeExpires: Date.now() + 10 * 60 * 1000 });
    const mailResult = await sendVerificationEmail(user.email, code, user.username);
    const masked = user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    res.json({ ok: true, email: masked, devMode: mailResult.devMode, code: mailResult.devMode ? code : undefined });
  });

  app.post('/api/auth/resendResetCode', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.json({ ok: false, error: 'Benutzername erforderlich.' });
    const user = db.getUserByUsername(username);
    if (!user || !user.email) return res.json({ ok: false, error: 'Kein Konto gefunden.' });
    const code = auth.generateVerificationCode();
    db.updateUser(user.id, { resetCode: code, resetCodeExpires: Date.now() + 10 * 60 * 1000 });
    const mailResult = await sendVerificationEmail(user.email, code, user.username);
    res.json({ ok: true, devMode: mailResult.devMode, code: mailResult.devMode ? code : undefined });
  });

  app.post('/api/auth/resetPassword', (req, res) => {
    const { username, code, newPassword } = req.body;
    if (!username || !code || !newPassword) return res.json({ ok: false, error: 'Alle Felder erforderlich.' });
    if (newPassword.length < 1) return res.json({ ok: false, error: 'Passwort darf nicht leer sein.' });
    const user = db.getUserByUsername(username);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!user.resetCode) return res.json({ ok: false, error: 'Kein Reset-Code vorhanden. Bitte neuen anfordern.' });
    if (user.resetCodeExpires && Date.now() > user.resetCodeExpires) return res.json({ ok: false, error: 'Code abgelaufen. Bitte neuen Code anfordern.' });
    if (user.resetCode !== code) return res.json({ ok: false, error: 'Falscher Code.' });
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.changePassword(user.id, newHash);
    db.updateUser(user.id, { resetCode: null, resetCodeExpires: null });
    res.json({ ok: true });
  });

  // ── E-Mail Verifizierung ──
  app.post('/api/email/verify', async (req, res) => {
    const { userId, code } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (user.emailVerified) return res.json({ ok: true, error: 'Bereits verifiziert.' });
    if (!user.verificationCode) return res.json({ ok: false, error: 'Kein Verifizierungscode vorhanden.' });
    if (user.verificationExpires && Date.now() > user.verificationExpires) return res.json({ ok: false, error: 'Code abgelaufen. Bitte neuen Code anfordern.' });
    if (user.verificationCode !== code) return res.json({ ok: false, error: 'Falscher Code.' });
    db.updateUser(userId, { emailVerified: true, verificationCode: null, verificationExpires: null });
    res.json({ ok: true });
  });

  app.post('/api/email/resend', async (req, res) => {
    const { userId } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (user.emailVerified) return res.json({ ok: false, error: 'Bereits verifiziert.' });
    const newCode = auth.generateVerificationCode();
    db.updateUser(userId, { verificationCode: newCode, verificationExpires: Date.now() + 5 * 60 * 1000 });
    const mailResult = await sendVerificationEmail(user.email, newCode, user.username);
    res.json({ ok: true, devMode: mailResult.devMode, code: newCode, mailError: mailResult.reason || null });
  });

  app.post('/api/email/change', async (req, res) => {
    const { userId, newEmail } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.json({ ok: false, error: 'Gültige E-Mail-Adresse erforderlich.' });
    const existing = db.getUserByEmail(newEmail);
    if (existing && existing.id !== userId) return res.json({ ok: false, error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
    const newCode = auth.generateVerificationCode();
    db.updateUser(userId, { email: newEmail, emailVerified: false, verificationCode: newCode, verificationExpires: Date.now() + 5 * 60 * 1000 });
    const mailResult = await sendVerificationEmail(newEmail, newCode, user.username);
    res.json({ ok: true, devMode: mailResult.devMode, code: mailResult.devMode ? newCode : undefined });
  });

  // ── Profil ──
  app.post('/api/profile/update', (req, res) => {
    const { userId, patch } = req.body;
    const updated = db.updateUser(userId, patch);
    if (!updated) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    res.json({ ok: true, user: auth.publicUser(updated) });
  });

  app.post('/api/profile/get', (req, res) => {
    const { userId } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    res.json({ ok: true, user: auth.publicUser(user) });
  });

  // ── Admin ──
  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const stored = db.getAdminPassword();
    if (!stored) return res.json({ ok: true, firstTime: true });
    if (bcrypt.compareSync(password, stored)) return res.json({ ok: true });
    res.json({ ok: false, error: 'Falsches Passwort.' });
  });

  app.post('/api/admin/setPassword', (req, res) => {
    db.setAdminPassword(bcrypt.hashSync(req.body.password, 10));
    res.json({ ok: true });
  });

  app.post('/api/admin/getAllUsers', (req, res) => {
    res.json(db.getAllUsers().map(u => auth.publicUser(u)));
  });

  app.post('/api/admin/deleteUser', (req, res) => {
    const caller = db.getUserById(req.body.callerId);
    if (!caller) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (req.body.userId === req.body.callerId) {
      db.deleteUser(req.body.userId);
      return res.json({ ok: true });
    }
    if (!caller.is_owner) return res.json({ ok: false, error: 'Nur der Owner kann andere Nutzer loeschen.' });
    const target = db.getUserById(req.body.userId);
    if (target && target.is_owner) return res.json({ ok: false, error: 'Der Owner kann nicht geloescht werden.' });
    db.deleteUser(req.body.userId);
    res.json({ ok: true });
  });

  app.post('/api/admin/toggleAdmin', (req, res) => {
    const caller = db.getUserById(req.body.callerId);
    if (!caller || !caller.is_owner) return res.json({ ok: false, error: 'Nur der Owner kann Admin-Rechte aendern.' });
    const user = db.getUserById(req.body.userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (user.is_owner) return res.json({ ok: false, error: 'Der Owner kann nicht degradiert werden.' });
    const updated = db.updateUser(req.body.userId, { is_admin: !user.is_admin });
    res.json({ ok: true, user: auth.publicUser(updated) });
  });

  // ── Server ──
  app.post('/api/server/create', (req, res) => {
    res.json(db.createServer(req.body.name, req.body.userId));
  });

  app.post('/api/server/update', (req, res) => {
    const { serverId, name, icon, description } = req.body;
    const data = db._read();
    const s = data.servers.find(s => s.id === serverId);
    if (s) {
      if (name !== undefined) s.name = name;
      if (icon !== undefined) s.icon = icon;
      if (description !== undefined) s.description = description;
    }
    db._write(data);
    res.json(s);
  });

  app.post('/api/server/getAll', (req, res) => res.json(db.getAllServers()));

  app.post('/api/server/getForUser', (req, res) => res.json(db.getServersForUser(req.body.userId)));

  app.post('/api/server/getById', (req, res) => {
    const server = db.getServerById(req.body.serverId);
    if (!server) return res.json({ ok: false });
    res.json({ ok: true, server });
  });

  app.post('/api/server/join', (req, res) => res.json(db.joinServer(req.body.serverId, req.body.userId)));

  app.post('/api/server/joinByCode', (req, res) => {
    const server = db.joinServerByCode(req.body.code, req.body.userId);
    if (!server) return res.json({ ok: false, error: 'Invite-Code ungueltig.' });
    res.json({ ok: true, server });
  });

  app.post('/api/server/leave', (req, res) => {
    db.leaveServer(req.body.serverId, req.body.userId);
    res.json({ ok: true });
  });

  app.post('/api/server/delete', (req, res) => {
    const server = db.getServerById(req.body.serverId);
    if (!server || server.ownerId !== req.body.userId) return res.json({ ok: false, error: 'Kein Recht.' });
    db.deleteServer(req.body.serverId);
    res.json({ ok: true });
  });

  app.post('/api/server/addChannel', (req, res) => {
    res.json(db.addChannel(req.body.serverId, req.body.name, req.body.type));
  });

  app.post('/api/server/deleteChannel', (req, res) => {
    db.deleteChannel(req.body.serverId, req.body.channelId);
    res.json({ ok: true });
  });

  app.post('/api/server/invite', (req, res) => {
    const user = db.getUserByUsername(req.body.username);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    db.joinServer(req.body.serverId, user.id);
    res.json({ ok: true });
  });

  app.post('/api/server/regenerateInviteCode', (req, res) => {
    const newCode = db.regenerateInviteCode(req.body.serverId);
    if (!newCode) return res.json({ ok: false });
    res.json({ ok: true, code: newCode });
  });

  app.post('/api/server/addRole', (req, res) => {
    res.json(db.addRole(req.body.serverId, req.body.name, req.body.color));
  });

  app.post('/api/server/deleteRole', (req, res) => {
    db.deleteRole(req.body.serverId, req.body.roleId);
    res.json({ ok: true });
  });

  app.post('/api/server/assignRole', (req, res) => {
    db.assignRole(req.body.serverId, req.body.roleId, req.body.userId);
    res.json({ ok: true });
  });

  app.post('/api/server/removeRole', (req, res) => {
    db.removeRole(req.body.serverId, req.body.roleId, req.body.userId);
    res.json({ ok: true });
  });

  app.post('/api/server/updateRole', (req, res) => {
    const role = db.updateRole(req.body.serverId, req.body.roleId, req.body.patch || {});
    if (!role) return res.json({ ok: false });
    res.json({ ok: true, role });
  });

  app.post('/api/server/getMembers', (req, res) => {
    const server = db.getServerById(req.body.serverId);
    if (!server) return res.json([]);
    res.json(server.members.map(id => {
      const user = db.getUserById(id);
      return user ? auth.publicUser(user) : null;
    }).filter(Boolean));
  });

  // ── Nachrichten ──
  app.post('/api/messages/get', (req, res) => res.json(db.getMessages(req.body.channelId)));

  app.post('/api/messages/send', (req, res) => {
    const { channelId, serverId, authorId, content, attachments } = req.body;
    res.json(db.sendMessage(channelId, serverId, authorId, content, attachments));
  });

  app.post('/api/messages/delete', (req, res) => {
    db.deleteMessage(req.body.msgId);
    res.json({ ok: true });
  });

  app.post('/api/messages/react', (req, res) => {
    res.json(db.addReaction(req.body.msgId, req.body.emoji, req.body.userId));
  });

  app.post('/api/messages/edit', (req, res) => {
    res.json(db.editMessage(req.body.msgId, req.body.content));
  });

  app.post('/api/messages/pin', (req, res) => {
    db.pinMessage(req.body.msgId);
    res.json({ ok: true });
  });

  // ── DMs ──
  app.post('/api/dm/getOrCreate', (req, res) => {
    res.json(db.getOrCreateDM(req.body.userId1, req.body.userId2));
  });

  app.post('/api/dm/getAll', (req, res) => res.json(db.getDMs(req.body.userId)));

  app.post('/api/dm/getMessages', (req, res) => res.json(db.getDMMessages(req.body.dmId)));

  app.post('/api/dm/send', (req, res) => {
    const { dmId, authorId, content, attachments } = req.body;
    res.json(db.sendDM(dmId, authorId, content, attachments));
  });

  // ── Friends ──
  app.post('/api/friends/getList', (req, res) => {
    res.json(db.getFriends(req.body.userId).map(u => auth.publicUser(u)));
  });

  app.post('/api/friends/getRequests', (req, res) => {
    const reqs = db.getFriendRequests(req.body.userId);
    res.json(reqs.map(r => {
      const from = db.getUserById(r.fromId);
      const to = db.getUserById(r.toId);
      return { ...r, fromUser: from ? auth.publicUser(from) : null, toUser: to ? auth.publicUser(to) : null };
    }));
  });

  app.post('/api/friends/sendRequest', (req, res) => {
    const friendReq = db.sendFriendRequest(req.body.fromId, req.body.toId);
    if (!friendReq) return res.json({ ok: false, error: 'Anfrage bereits vorhanden.' });
    res.json({ ok: true, request: friendReq });
  });

  app.post('/api/friends/acceptRequest', (req, res) => {
    const r = db.acceptFriendRequest(req.body.reqId);
    if (!r) return res.json({ ok: false });
    res.json({ ok: true });
  });

  app.post('/api/friends/declineRequest', (req, res) => {
    db.declineFriendRequest(req.body.reqId);
    res.json({ ok: true });
  });

  app.post('/api/friends/remove', (req, res) => {
    db.removeFriend(req.body.userId, req.body.friendId);
    res.json({ ok: true });
  });

  // ── Login-Medien ──
  app.post('/api/login/getMedia', (req, res) => {
    res.json(db._read().loginMedia || null);
  });

  app.post('/api/login/setMedia', (req, res) => {
    const { mediaPath, mediaKind } = req.body;
    const data = db._read();
    data.loginMedia = { path: mediaPath, kind: mediaKind };
    db._write(data);
    res.json({ ok: true });
  });

  app.post('/api/login/clearMedia', (req, res) => {
    const data = db._read();
    delete data.loginMedia;
    db._write(data);
    res.json({ ok: true });
  });

  // ── Users ──
  app.post('/api/users/getById', (req, res) => {
    const user = db.getUserById(req.body.userId);
    if (!user) return res.json({ ok: false });
    res.json({ ok: true, user: auth.publicUser(user) });
  });

  app.post('/api/users/getByIds', (req, res) => {
    const users = db.getUsersByIds(req.body.userIds);
    res.json(users.map(u => auth.publicUser(u)));
  });

  // ── 2FA (TOTP) ──
  app.post('/api/2fa/setup', async (req, res) => {
    const { userId } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (user.twoFactorEnabled) return res.json({ ok: false, error: '2FA ist bereits aktiviert.' });

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

    res.json({ ok: true, secret: totp.secret.base32, qrCode: qrDataUrl, otpauthUri: uri });
  });

  app.post('/api/2fa/verify', (req, res) => {
    const { userId, code } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!user.twoFactorPending) return res.json({ ok: false, error: 'Kein 2FA-Setup aktiv.' });

    const totp = new OTPAuth.TOTP({
      issuer: 'Kryotalk',
      label: user.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    });

    const delta = totp.validate({ token: code, window: 2 });
    if (delta === null) return res.json({ ok: false, error: 'Ungueltiger Code.' });

    db.updateUser(userId, { twoFactorEnabled: true, twoFactorPending: false });
    res.json({ ok: true });
  });

  app.post('/api/2fa/disable', (req, res) => {
    const { userId, code } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!user.twoFactorEnabled) return res.json({ ok: false, error: '2FA ist nicht aktiviert.' });

    const totp = new OTPAuth.TOTP({
      issuer: 'Kryotalk',
      label: user.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    });

    const delta = totp.validate({ token: code, window: 2 });
    if (delta === null) return res.json({ ok: false, error: 'Ungueltiger Code.' });

    db.updateUser(userId, { twoFactorEnabled: false, twoFactorPending: false, twoFactorSecret: null });
    res.json({ ok: true });
  });

  app.post('/api/2fa/checkOnLogin', (req, res) => {
    const { userId, code } = req.body;
    const user = db.getUserById(userId);
    if (!user) return res.json({ ok: false, error: 'Nutzer nicht gefunden.' });
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return res.json({ ok: true });

    const totp = new OTPAuth.TOTP({
      issuer: 'Kryotalk',
      label: user.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
    });

    const delta = totp.validate({ token: code, window: 2 });
    if (delta === null) return res.json({ ok: false, error: 'Falscher 2FA-Code.' });
    res.json({ ok: true });
  });

  // ── Catch-all for SPA (nur GET) ──
  app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'Endpoint nicht gefunden.' });
    }
    const filePath = path.join(__dirname, '..', 'renderer', req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return res.sendFile(filePath);
    }
    res.sendFile(path.join(__dirname, '..', 'renderer', 'login.html'));
  });

  app.all('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'Endpoint nicht gefunden: ' + req.method + ' ' + req.path });
    }
    res.status(404).json({ ok: false, error: 'Nicht gefunden.' });
  });

  app.use((err, req, res, next) => {
    console.error('[Server Error]', err.message);
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(500).json({ ok: false, error: 'Serverfehler: ' + err.message });
    }
    res.status(500).send('Serverfehler');
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('================================================');
    console.log('  Kryotalk Web-Server gestartet!');
    console.log('  Lokal:    http://localhost:' + PORT);
    console.log('  Netzwerk: http://' + ip + ':' + PORT);
    console.log('  Andere koennen jetzt ueber den Browser');
    console.log('  auf diese Adresse zugreifen.');
    console.log('================================================');
    console.log('');
  });

  // ── Socket.io Signaling (Voice/Video/Screen Calls) ──
  const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  const onlineUsers = new Map();
  const activeCalls = new Map();
  const voiceChannels = new Map(); // channelId -> Set of userIds

  io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('identify', (userId) => {
      currentUserId = userId;
      onlineUsers.set(userId, socket.id);
      socket.broadcast.emit('user:online', userId);
      socket.emit('online:users', Array.from(onlineUsers.keys()));
    });

    socket.on('call:start', ({ targetId, callType }) => {
      const callerData = db.getUserById(currentUserId);
      if (!callerData) return;
      const targetSocketId = onlineUsers.get(targetId);
      const callId = currentUserId + '_' + targetId + '_' + Date.now();
      activeCalls.set(callId, { callerId: currentUserId, targetId, callType, status: 'ringing' });
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callId, callerId: currentUserId, callerName: callerData.username,
          callerAvatar: callerData.avatarPath, callType
        });
      }
      socket.emit('call:ringing', { callId });
    });

    socket.on('call:accept', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      call.status = 'active';
      const callerSocketId = onlineUsers.get(call.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call:accepted', { callId, targetId: currentUserId });
      }
    });

    socket.on('call:reject', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      call.status = 'rejected';
      const callerSocketId = onlineUsers.get(call.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call:rejected', { callId });
      }
      activeCalls.delete(callId);
    });

    socket.on('call:end', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call:ended', { callId });
      }
      activeCalls.delete(callId);
    });

    socket.on('call:offer', ({ callId, callType, offer }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (callType) call.callType = callType;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call:offer', { callId, callType: call.callType, offer, fromId: currentUserId });
      }
    });

    socket.on('call:answer', ({ callId, answer }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call:answer', { callId, answer, fromId: currentUserId });
      }
    });

    socket.on('call:ice-candidate', ({ callId, candidate }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call:ice-candidate', { callId, candidate, fromId: currentUserId });
      }
    });

    socket.on('call:toggle-audio', ({ callId, muted }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) io.to(otherSocketId).emit('call:toggle-audio', { callId, fromId: currentUserId, muted });
    });

    socket.on('call:toggle-video', ({ callId, off }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
      const otherSocketId = onlineUsers.get(otherId);
      if (otherSocketId) io.to(otherSocketId).emit('call:toggle-video', { callId, fromId: currentUserId, off });
    });

    // ── Voice Channel Events ──
    socket.on('voice:join', ({ channelId }) => {
      if (!currentUserId || !channelId) return;
      for (const [cid, users] of voiceChannels.entries()) {
        if (users.has(currentUserId)) { users.delete(currentUserId); }
      }
      if (!voiceChannels.has(channelId)) voiceChannels.set(channelId, new Set());
      voiceChannels.get(channelId).add(currentUserId);
      const state = {};
      for (const [cid, users] of voiceChannels.entries()) { state[cid] = Array.from(users); }
      io.emit('voice:state', state);
    });

    socket.on('voice:leave', () => {
      if (!currentUserId) return;
      for (const [cid, users] of voiceChannels.entries()) {
        if (users.has(currentUserId)) { users.delete(currentUserId); }
      }
      const state = {};
      for (const [cid, users] of voiceChannels.entries()) { state[cid] = Array.from(users); }
      io.emit('voice:state', state);
    });

    socket.on('disconnect', () => {
      if (currentUserId) {
        onlineUsers.delete(currentUserId);
        socket.broadcast.emit('user:offline', currentUserId);
        for (const [callId, call] of activeCalls.entries()) {
          if (call.callerId === currentUserId || call.targetId === currentUserId) {
            const otherId = call.callerId === currentUserId ? call.targetId : call.callerId;
            const otherSocketId = onlineUsers.get(otherId);
            if (otherSocketId) io.to(otherSocketId).emit('call:ended', { callId });
            activeCalls.delete(callId);
          }
        }
        for (const [cid, users] of voiceChannels.entries()) {
          if (users.has(currentUserId)) { users.delete(currentUserId); }
        }
        const state = {};
        for (const [cid, users] of voiceChannels.entries()) { state[cid] = Array.from(users); }
        io.emit('voice:state', state);
      }
    });
  });

  return server;
}

module.exports = { createServer };
