const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');

const OWNER_USERNAME = 'lol';
const OWNER_PASSWORD = '8wayezehwÜ12';

function generateInviteCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

class JsonDB {
  constructor(dbFilePath) {
    this.dbFilePath = dbFilePath;
    this._writeLock = Promise.resolve();
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.dbFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.dbFilePath)) {
      this._writeSync({ users: [], servers: [], messages: [], dms: [], adminPassword: null, loginMedia: null });
    }
    const data = this._read();
    if (data.servers) {
      data.servers.forEach(s => { if (!s.inviteCode) s.inviteCode = generateInviteCode(); });
    }
    if (data.users) {
      data.users.forEach(u => {
        if (!('email' in u)) u.email = '';
        if (!('emailVerified' in u)) u.emailVerified = false;
        if (!('phone' in u)) u.phone = '';
        if (!('twoFactorEnabled' in u)) u.twoFactorEnabled = false;
        if (!('twoFactorCode' in u)) u.twoFactorCode = null;
        if (!('twoFactorSecret' in u)) u.twoFactorSecret = null;
        if (!('twoFactorPending' in u)) u.twoFactorPending = false;
        if (!('status' in u)) u.status = 'online';
        if (!('is_owner' in u)) u.is_owner = false;
      });
    }
    if (!data.adminPassword) {
      data.adminPassword = bcrypt.hashSync(OWNER_PASSWORD, 10);
    }
    this._writeSync(data);
  }

  _backupCorruptFile() {
    try {
      const backupDir = path.join(path.dirname(this.dbFilePath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `db-corrupt-${ts}.json`);
      fs.copyFileSync(this.dbFilePath, backupPath);
      console.log('[DB] Backed up corrupt file to', backupPath);
    } catch (e) {
      console.error('[DB] Failed to backup corrupt file:', e.message);
    }
  }

  _read() {
    const defaults = { users: [], servers: [], messages: [], dms: [], adminPassword: null, loginMedia: null };
    try {
      const raw = fs.readFileSync(this.dbFilePath, 'utf-8');
      const data = JSON.parse(raw);
      for (const k of Object.keys(defaults)) { if (!(k in data)) data[k] = defaults[k]; }
      this._lastGoodData = data;
      return data;
    } catch (e) {
      console.error('[DB] Read/parse failed:', e.message);
      this._backupCorruptFile();
      if (this._lastGoodData) {
        console.log('[DB] Recovering from last good in-memory state');
        return JSON.parse(JSON.stringify(this._lastGoodData));
      }
      const backup = this._loadBackup();
      if (backup) {
        console.log('[DB] Recovering from backup file');
        this._lastGoodData = backup;
        return backup;
      }
      console.log('[DB] No backup available, returning empty defaults');
      return defaults;
    }
  }

  _loadBackup() {
    try {
      const backupDir = path.join(path.dirname(this.dbFilePath), 'backups');
      if (!fs.existsSync(backupDir)) return null;
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('db-backup-'))
        .sort()
        .reverse();
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf-8'));
          if (data && data.users) return data;
        } catch (e) { /* skip broken backups */ }
      }
    } catch (e) { /* no backups dir */ }
    return null;
  }

  _writeSync(data) {
    const tmpPath = this.dbFilePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, this.dbFilePath);
      this._lastGoodData = data;
      this._saveBackup(data);
    } catch (e) {
      console.error('[DB] Write failed:', e.message);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e2) {}
      throw e;
    }
  }

  _saveBackup(data) {
    try {
      const backupDir = path.join(path.dirname(this.dbFilePath), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, 'db-backup-latest.json');
      fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
    } catch (e) { /* non-critical */ }
  }

  _write(data) {
    return new Promise((resolve, reject) => {
      this._writeLock = this._writeLock.then(() => {
        try {
          this._writeSync(data);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      return this._writeLock;
    });
  }

  _mutate(fn) {
    const p = this._writeLock.then(() => {
      const data = this._read();
      fn(data);
      this._writeSync(data);
      return data;
    });
    this._writeLock = p.then(() => {}, () => {});
    return p;
  }

  // ── Users ──
  getAllUsers() { return this._read().users; }
  getAllUsernames() { return this.getAllUsers().map((u) => u.username); }
  getUserByUsername(username) {
    const lower = username.toLowerCase();
    return this.getAllUsers().find((u) => u.username.toLowerCase() === lower) || null;
  }
  getUserById(id) { return this.getAllUsers().find((u) => u.id === id) || null; }
  getUserByEmail(email) {
    if (!email) return null;
    const lower = email.toLowerCase();
    return this.getAllUsers().find((u) => (u.email || '').toLowerCase() === lower) || null;
  }
  createUser(user) {
    const data = this._read();
    data.users.push(user);
    this._writeSync(data);
    return user;
  }
  getUsersByIds(ids) {
    const all = this.getAllUsers();
    return ids.map(id => all.find(u => u.id === id)).filter(Boolean);
  }
  updateUser(id, patch) {
    const data = this._read();
    const idx = data.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    data.users[idx] = { ...data.users[idx], ...patch };
    this._writeSync(data);
    return data.users[idx];
  }
  deleteUser(id) {
    const data = this._read();
    data.users = data.users.filter((u) => u.id !== id);
    this._writeSync(data);
  }

  // ── Admin Password ──
  getAdminPassword() { return this._read().adminPassword || null; }
  setAdminPassword(hash) {
    const data = this._read();
    data.adminPassword = hash;
    this._writeSync(data);
  }

  // ── Servers ──
  _resolveMembers(server) {
    if (!server || !server.members) return server;
    const data = this._read();
    const users = data.users || [];
    server.members = server.members.map(m => {
      if (typeof m === 'string') {
        const user = users.find(u => u.id === m);
        return user
          ? { id: user.id, userId: user.id, username: user.username, avatarPath: user.avatarPath || null, bannerPath: user.bannerPath || null, status: user.status || 'online', is_owner: user.is_owner || false, isAdmin: user.isAdmin || false, aboutMe: user.aboutMe || '', rarityLabel: user.rarityLabel || '', rarityKey: user.rarityKey || '', createdAt: user.createdAt || '' }
          : { id: m, userId: m, username: 'Unbekannt', avatarPath: null, status: 'offline', is_owner: false, isAdmin: false };
      }
      return m;
    });
    return server;
  }
  getAllServers() { return this._read().servers; }
  getServersForUser(userId) {
    const servers = this._read().servers.filter(s => s.members && s.members.includes(userId));
    return servers.map(s => this._resolveMembers(JSON.parse(JSON.stringify(s))));
  }
  getServerById(id) {
    const server = this.getAllServers().find((s) => s.id === id) || null;
    return server ? this._resolveMembers(JSON.parse(JSON.stringify(server))) : null;
  }
  getServerByInviteCode(code) {
    if (!code) return null;
    const upper = code.toUpperCase();
    return this.getAllServers().find(s => s.inviteCode && s.inviteCode.toUpperCase() === upper) || null;
  }
  createServer(name, ownerId, icon) {
    const data = this._read();
    const server = {
      id: randomUUID(),
      name,
      icon: icon || null,
      description: '',
      ownerId,
      members: [ownerId],
      inviteCode: generateInviteCode(),
      categories: [{ id: randomUUID(), name: 'TEXTKANÄLE', collapsed: false }],
      channels: [{ id: randomUUID(), name: 'allgemein', type: 'text' }],
      roles: [
        { id: randomUUID(), name: 'Admin', color: '#da373c', permissions: ['all'], memberIds: [ownerId] },
        { id: randomUUID(), name: 'Mitglied', color: '#949ba4', permissions: ['read', 'write'], memberIds: [] },
      ],
      createdAt: new Date().toISOString(),
    };
    data.servers.push(server);
    this._writeSync(data);
    return server;
  }
  updateServer(id, patch) {
    const data = this._read();
    const idx = data.servers.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    data.servers[idx] = { ...data.servers[idx], ...patch };
    this._writeSync(data);
    return data.servers[idx];
  }
  deleteServer(id) {
    const data = this._read();
    data.servers = data.servers.filter((s) => s.id !== id);
    data.messages = data.messages.filter((m) => m.serverId !== id);
    this._writeSync(data);
  }
  joinServer(serverId, userId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server || server.members.includes(userId)) return server;
    server.members.push(userId);
    const memberRole = server.roles.find((r) => r.name === 'Mitglied');
    if (memberRole) memberRole.memberIds.push(userId);
    this._writeSync(data);
    return server;
  }
  joinServerByCode(code, userId) {
    if (!code) return null;
    const server = this.getServerByInviteCode(code);
    if (!server) return null;
    return this.joinServer(server.id, userId);
  }
  regenerateInviteCode(serverId) {
    const data = this._read();
    const server = data.servers.find(s => s.id === serverId);
    if (!server) return null;
    server.inviteCode = generateInviteCode();
    this._writeSync(data);
    return server.inviteCode;
  }
  leaveServer(serverId, userId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return;
    server.members = server.members.filter((m) => m !== userId);
    server.roles.forEach((r) => { r.memberIds = r.memberIds.filter((m) => m !== userId); });
    this._writeSync(data);
  }
  addChannel(serverId, name, type) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return null;
    const channel = { id: randomUUID(), name, type: type || 'text' };
    server.channels.push(channel);
    this._writeSync(data);
    return channel;
  }
  deleteChannel(serverId, channelId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return;
    server.channels = server.channels.filter((c) => c.id !== channelId);
    data.messages = data.messages.filter((m) => m.channelId !== channelId);
    this._writeSync(data);
  }
  addRole(serverId, name, color, permissions) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return null;
    const role = { id: randomUUID(), name, color: color || '#949ba4', permissions: permissions || ['read', 'write'], memberIds: [] };
    server.roles.push(role);
    this._writeSync(data);
    return role;
  }
  deleteRole(serverId, roleId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return;
    server.roles = server.roles.filter((r) => r.id !== roleId);
    this._writeSync(data);
  }
  assignRole(serverId, roleId, userId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return;
    const role = server.roles.find((r) => r.id === roleId);
    if (!role || role.memberIds.includes(userId)) return;
    role.memberIds.push(userId);
    this._writeSync(data);
  }
  removeRole(serverId, roleId, userId) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return;
    const role = server.roles.find((r) => r.id === roleId);
    if (!role) return;
    role.memberIds = role.memberIds.filter((id) => id !== userId);
    this._writeSync(data);
  }
  updateRole(serverId, roleId, patch) {
    const data = this._read();
    const server = data.servers.find((s) => s.id === serverId);
    if (!server) return null;
    const role = server.roles.find((r) => r.id === roleId);
    if (!role) return null;
    if (patch.name !== undefined) role.name = patch.name;
    if (patch.color !== undefined) role.color = patch.color;
    this._writeSync(data);
    return role;
  }

  // ── Messages ──
  getMessages(channelId) {
    return this._read().messages.filter((m) => m.channelId === channelId).sort((a, b) => a.timestamp - b.timestamp);
  }
  sendMessage(channelId, serverId, authorId, content, attachments) {
    const data = this._read();
    const msg = {
      id: randomUUID(),
      channelId,
      serverId: serverId || null,
      authorId,
      content,
      timestamp: Date.now(),
      reactions: [],
      attachments: attachments || [],
    };
    data.messages.push(msg);
    this._writeSync(data);
    return msg;
  }
  deleteMessage(msgId) {
    const data = this._read();
    data.messages = data.messages.filter((m) => m.id !== msgId);
    this._writeSync(data);
  }
  addReaction(msgId, emoji, userId) {
    const data = this._read();
    const msg = data.messages.find((m) => m.id === msgId);
    if (!msg) return;
    let reaction = msg.reactions.find((r) => r.emoji === emoji);
    if (!reaction) {
      reaction = { emoji, userIds: [] };
      msg.reactions.push(reaction);
    }
    if (reaction.userIds.includes(userId)) {
      reaction.userIds = reaction.userIds.filter((u) => u !== userId);
      if (reaction.userIds.length === 0) msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
    } else {
      reaction.userIds.push(userId);
    }
    this._writeSync(data);
    return msg;
  }

  editMessage(msgId, newContent) {
    const data = this._read();
    const msg = data.messages.find(m => m.id === msgId);
    if (!msg) return null;
    msg.content = newContent;
    msg.edited = true;
    this._writeSync(data);
    return msg;
  }
  pinMessage(msgId) {
    const data = this._read();
    const msg = data.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.pinned = true;
    this._writeSync(data);
  }
  changePassword(userId, newPasswordHash) {
    return this.updateUser(userId, { passwordHash: newPasswordHash });
  }

  // ── DMs ──
  getDMs(userId) {
    return this._read().dms.filter((d) => d.participants.includes(userId));
  }
  getDM(userId1, userId2) {
    return this._read().dms.find((d) =>
      d.participants.includes(userId1) && d.participants.includes(userId2)
    ) || null;
  }
  getOrCreateDM(userId1, userId2) {
    const data = this._read();
    let dm = data.dms.find((d) =>
      d.participants.includes(userId1) && d.participants.includes(userId2)
    );
    if (!dm) {
      dm = { id: randomUUID(), participants: [userId1, userId2], messages: [] };
      data.dms.push(dm);
      this._writeSync(data);
    }
    return dm;
  }
  sendDM(dmId, authorId, content, attachments) {
    const data = this._read();
    const dm = data.dms.find((d) => d.id === dmId);
    if (!dm) return null;
    const msg = {
      id: randomUUID(),
      authorId,
      content,
      timestamp: Date.now(),
      attachments: attachments || [],
    };
    dm.messages.push(msg);
    this._writeSync(data);
    return msg;
  }
  getDMMessages(dmId) {
    const dm = this._read().dms.find((d) => d.id === dmId);
    return dm ? dm.messages : [];
  }

  // ── Friends ──
  getFriends(userId) {
    const user = this.getUserById(userId);
    if (!user) return [];
    const ids = user.friends || [];
    return ids.map(id => this.getUserById(id)).filter(Boolean);
  }
  getFriendRequests(userId) {
    const data = this._read();
    return (data.friendRequests || []).filter(r => r.toId === userId || r.fromId === userId);
  }
  sendFriendRequest(fromId, toId) {
    const data = this._read();
    if (!data.friendRequests) data.friendRequests = [];
    const existing = data.friendRequests.find(r =>
      (r.fromId === fromId && r.toId === toId) || (r.fromId === toId && r.toId === fromId)
    );
    if (existing) return null;
    const fromUser = this.getUserById(fromId);
    const toUser = this.getUserById(toId);
    if (!fromUser || !toUser) return null;
    if (toUser.privacy && toUser.privacy.allowFriendReq === false) return null;
    const req = { id: randomUUID(), fromId, toId, timestamp: Date.now(), status: 'pending' };
    data.friendRequests.push(req);
    this._writeSync(data);
    return req;
  }
  acceptFriendRequest(reqId) {
    const data = this._read();
    if (!data.friendRequests) data.friendRequests = [];
    const req = data.friendRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return null;
    req.status = 'accepted';
    const fromUser = data.users.find(u => u.id === req.fromId);
    const toUser = data.users.find(u => u.id === req.toId);
    if (fromUser) { if (!fromUser.friends) fromUser.friends = []; if (!fromUser.friends.includes(req.toId)) fromUser.friends.push(req.toId); }
    if (toUser) { if (!toUser.friends) toUser.friends = []; if (!toUser.friends.includes(req.fromId)) toUser.friends.push(req.fromId); }
    this._writeSync(data);
    return req;
  }
  declineFriendRequest(reqId) {
    const data = this._read();
    if (!data.friendRequests) data.friendRequests = [];
    data.friendRequests = data.friendRequests.filter(r => r.id !== reqId);
    this._writeSync(data);
    return { ok: true };
  }
  removeFriend(userId, friendId) {
    const data = this._read();
    const user = data.users.find(u => u.id === userId);
    const friend = data.users.find(u => u.id === friendId);
    if (user) user.friends = (user.friends || []).filter(id => id !== friendId);
    if (friend) friend.friends = (friend.friends || []).filter(id => id !== userId);
    this._writeSync(data);
    return { ok: true };
  }
}

module.exports = { JsonDB };
