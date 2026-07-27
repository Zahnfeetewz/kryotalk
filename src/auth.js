const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const rarity = require('./rarity');

function register(db, { username, password, email, avatarPath, bannerPath, bannerType }) {
  const format = rarity.validateUsernameFormat(username);
  if (!format.ok) {
    return { ok: false, error: format.reason };
  }

  if (!password || password.length < 1) {
    return { ok: false, error: 'Passwort darf nicht leer sein.' };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Gültige E-Mail-Adresse erforderlich.' };
  }

  if (db.getUserByUsername(username)) {
    return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' };
  }

  if (db.getUserByEmail && db.getUserByEmail(email)) {
    return { ok: false, error: 'Diese E-Mail-Adresse ist bereits registriert.' };
  }

  const existingUsernames = db.getAllUsernames();
  const availability = rarity.checkAvailability(username, existingUsernames);
  if (availability.remaining <= 0) {
    return { ok: false, error: 'Für diese Namenslänge sind keine Kombinationen mehr frei.' };
  }

  const tier = rarity.getRarityForLength(username.length);
  const passwordHash = bcrypt.hashSync(password, 10);

  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

  const user = {
    id: randomUUID(),
    username,
    passwordHash,
    avatarPath: avatarPath || null,
    bannerPath: bannerPath || null,
    bannerType: bannerType || 'image',
    theme: 'dark',
    accentColor: '#5865F2',
    rarityKey: tier.key,
    rarityLabel: tier.label,
    aboutMe: '',
    backgroundPath: null,
    backgroundKind: null,
    backgroundSound: false,
    is_admin: false,
    is_owner: false,
    lastIP: '',
    email: email,
    emailVerified: false,
    verificationCode: verificationCode,
    verificationExpires: Date.now() + 5 * 60 * 1000,
    phone: '',
    twoFactorEnabled: false,
    twoFactorCode: null,
    twoFactorSecret: null,
    twoFactorPending: false,
    status: 'online',
    createdAt: new Date().toISOString(),
  };

  db.createUser(user);
  return { ok: true, user: publicUser(user), needsVerification: true };
}

function login(db, { username, password }) {
  const user = db.getUserByUsername(username);
  if (!user) {
    return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
  }
  const valid = bcrypt.compareSync(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
  }
  return { ok: true, user: publicUser(user) };
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function publicUser(user) {
  const { passwordHash, twoFactorCode, twoFactorSecret, verificationCode, resetCode, resetCodeExpires, ...safe } = user;
  return safe;
}

module.exports = { register, login, publicUser, generateVerificationCode };
