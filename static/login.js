const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formTitle = document.getElementById('form-title');

// ── E-Mail Verifizierung ──
let pendingVerifyUserId = null;
let pendingVerifyEmail = '';

// ---- Login-Medien laden ----
(async () => {
  if (window.api?.ready) await window.api.ready;
  const media = await window.api.getMedia();
  if (!media || !media.path) return;
  const img = document.getElementById('login-bg-image');
  const vid = document.getElementById('login-bg-video');
  if (media.kind === 'video') {
    vid.src = toFileUrl(media.path);
    vid.classList.remove('hidden');
  } else {
    img.src = toFileUrl(media.path);
    img.classList.remove('hidden');
  }
})();

// ---- Login-Profilvorschau: User tippen -> Profil + Background anzeigen ----
var _TPIXEL='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; function toFileUrl(p) { if (!p) return _TPIXEL; return window.api?.toFileUrl?.(p) || _TPIXEL; }

function defaultAvatar(letter) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">
    <rect width="56" height="56" fill="#5865f2"/>
    <text x="28" y="36" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">${letter}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

const loginUsername = document.getElementById('login-username');
const previewWrap = document.getElementById('login-profile-preview');
const previewBanner = document.getElementById('preview-banner');
const previewAvatar = document.getElementById('preview-avatar');
const previewName = document.getElementById('preview-name');
const previewRarity = document.getElementById('preview-rarity');
const bgImg = document.getElementById('login-bg-image');
const bgVid = document.getElementById('login-bg-video');
let profileTimer = null;

function clearProfilePreview() {
  previewWrap.classList.add('hidden');
  document.body.classList.remove('has-profile-bg');
  bgImg.classList.add('hidden');
  bgImg.src = '';
  bgVid.classList.add('hidden');
  bgVid.pause();
  bgVid.src = '';
}

loginUsername.addEventListener('input', () => {
  clearTimeout(profileTimer);
  const val = loginUsername.value.trim();
  if (!val) {
    clearProfilePreview();
    return;
  }
  profileTimer = setTimeout(async () => {
    const result = await window.api.getUserPublic(val);
    if (!result.ok) {
      clearProfilePreview();
      return;
    }
    const u = result.user;

    previewAvatar.src = u.avatarPath ? toFileUrl(u.avatarPath) : defaultAvatar((u.username || '?')[0].toUpperCase());
    previewName.textContent = u.username;
    previewRarity.textContent = u.rarityLabel;
    previewRarity.className = `preview-rarity rarity-${u.rarityKey}`;

    if (u.bannerPath) {
      previewBanner.style.backgroundImage = `url("${toFileUrl(u.bannerPath)}")`;
      previewBanner.style.display = 'block';
    } else {
      previewBanner.style.display = 'none';
    }

    bgImg.classList.add('hidden');
    bgImg.src = '';
    bgVid.classList.add('hidden');
    bgVid.pause();
    bgVid.src = '';

    if (u.backgroundPath) {
      document.body.classList.add('has-profile-bg');
      if (u.backgroundKind === 'video') {
        bgVid.src = toFileUrl(u.backgroundPath);
        bgVid.classList.remove('hidden');
        bgVid.play().catch(() => {});
      } else {
        bgImg.src = toFileUrl(u.backgroundPath);
        bgImg.classList.remove('hidden');
      }
    } else {
      document.body.classList.remove('has-profile-bg');
    }

    previewWrap.classList.remove('hidden');
  }, 300);
});

loginUsername.addEventListener('blur', () => {
  setTimeout(() => {
    if (!loginUsername.value.trim()) {
      previewWrap.classList.add('hidden');
    }
  }, 150);
});

// ---- Tabs ----
tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  formTitle.textContent = t('welcomeBack');
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  formTitle.textContent = t('createAccount');
});

// ---- Login ----
let loginPendingUser = null;

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const code = document.getElementById('login-2fa-code')?.value?.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (loginPendingUser) {
    if (!code || code.length !== 6) {
      errorEl.textContent = t('sixDigitCode');
      return;
    }
    const tfaRes = await window.api.twoFACheckOnLogin(loginPendingUser.id, code);
    if (!tfaRes?.ok) {
      errorEl.textContent = tfaRes?.error || t('wrongCode');
      return;
    }
    localStorage.setItem('currentUserId', loginPendingUser.id);
    window.location.href = 'app.html';
    return;
  }

  const result = await window.api.login(username, password);
  if (!result.ok) {
    errorEl.textContent = result.error;
    return;
  }

  if (result.user.twoFactorEnabled) {
    loginPendingUser = result.user;
    document.getElementById('login-2fa-section')?.classList.remove('hidden');
    document.getElementById('login-2fa-code')?.focus();
    errorEl.textContent = '';
    return;
  }

  if (result.user.email && !result.user.emailVerified) {
    pendingVerifyUserId = result.user.id;
    pendingVerifyEmail = result.user.email;
    document.getElementById('verify-email-display').textContent = result.user.email;
    document.getElementById('verify-code').value = '';
    document.getElementById('verify-error').textContent = '';
    document.getElementById('verify-dev-code').style.display = 'none';
    loginForm.classList.add('hidden');
    tabLogin.classList.add('hidden');
    tabRegister.classList.add('hidden');
    formTitle.textContent = t('verifyYourEmail');
    document.querySelector('.login-card').classList.add('hidden');
    document.getElementById('verify-overlay').classList.remove('hidden');
    window.api.emailResend(result.user.id).then(function(r) {
      if (r && r.code) {
        document.getElementById('verify-dev-code').style.display = 'block';
        document.getElementById('verify-dev-code').textContent = t('devModeCode') + r.code;
        document.getElementById('verify-code').value = r.code;
      }
    });
    return;
  }

  localStorage.setItem('currentUserId', result.user.id);
  window.location.href = 'app.html';
});

// ---- Registrierung: Live-Rarity-Anzeige ----
const regUsername = document.getElementById('reg-username');
const usernameHint = document.getElementById('username-hint');
let checkTimer = null;

regUsername.addEventListener('input', () => {
  clearTimeout(checkTimer);
  const value = regUsername.value.trim();
  if (!value) {
    usernameHint.innerHTML = '';
    return;
  }
  checkTimer = setTimeout(async () => {
    const result = await window.api.checkUsername(value);
    if (!result.ok) {
      usernameHint.innerHTML = `<span style="color:#fa777c">${result.error}</span>`;
      return;
    }
    const badge = `<span class="rarity-badge rarity-${result.rarityKey}">${result.rarityLabel}</span>`;
    if (result.taken) {
      usernameHint.innerHTML = `<span style="color:var(--red)">${t('usernameTaken')}</span> ${badge}`;
    } else {
      usernameHint.innerHTML = `<span style="color:#3ba55d">${t('available')}</span> ${badge} · ${result.remaining.toLocaleString(getLocale())} ${t('namesRemaining')}`;
    }
  }, 250);
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = regUsername.value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = t('validEmailRequired');
    return;
  }

  if (password !== password2) {
    errorEl.textContent = t('passwordsNoMatch');
    return;
  }

  const result = await window.api.register(username, password, email);
  if (!result.ok) {
    errorEl.textContent = result.error;
    return;
  }

  pendingVerifyUserId = result.user.id;
  pendingVerifyEmail = email;
  document.getElementById('verify-email-display').textContent = email;
  document.getElementById('verify-code').value = '';
  document.getElementById('verify-error').textContent = '';

  if (result.sent) {
    document.getElementById('verify-dev-code').style.display = 'none';
    var sentNote = document.createElement('p');
    sentNote.style.cssText = 'text-align:center;font-size:13px;color:#3ba55d;margin:8px 0';
    sentNote.textContent = t('codeSentTo') + ' ' + email;
    document.getElementById('verify-overlay').querySelector('.login-card').insertBefore(sentNote, document.getElementById('verify-code'));
  }

  document.getElementById('verify-dev-code').style.display = 'block';
  document.getElementById('verify-dev-code').textContent = t('devModeCode') + result.code;

  document.getElementById('verify-code').value = result.code;

  document.querySelector('.login-card').classList.add('hidden');
  document.getElementById('verify-overlay').classList.remove('hidden');
});

// ── E-Mail Verifizierung (Button-Handler) ──

document.getElementById('verify-submit')?.addEventListener('click', async () => {
  const code = document.getElementById('verify-code').value.trim();
  const errorEl = document.getElementById('verify-error');
  errorEl.textContent = '';

  if (!code || code.length !== 6) {
    errorEl.textContent = t('sixDigitCode');
    return;
  }

  const result = await window.api.emailVerify(pendingVerifyUserId, code);
  if (!result.ok) {
    errorEl.textContent = result.error;
    return;
  }

  localStorage.setItem('currentUserId', pendingVerifyUserId);
  window.location.href = 'app.html';
});

document.getElementById('verify-resend')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('verify-error');
  errorEl.textContent = '';
  const btn = document.getElementById('verify-resend');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const result = await window.api.emailResend(pendingVerifyUserId);
    if (result.ok) {
      if (result.sent) {
        errorEl.textContent = t('codeSentTo') + ' ' + pendingVerifyEmail;
        errorEl.style.color = '#3ba55d';
      } else if (result.code) {
        errorEl.textContent = t('emailSendFailed');
        errorEl.style.color = '#faa61a';
      }
      if (result.code) {
        document.getElementById('verify-dev-code').style.display = 'block';
        document.getElementById('verify-dev-code').textContent = t('devModeCode') + result.code;
        document.getElementById('verify-code').value = result.code;
        setTimeout(function() { document.getElementById('verify-submit').click(); }, 500);
      }
      setTimeout(() => { errorEl.textContent = ''; errorEl.style.color = ''; }, 5000);
    } else {
      errorEl.textContent = result.error || 'Fehler';
      errorEl.style.color = '#ed4245';
    }
  } finally {
    btn.textContent = t('resendCode');
    btn.disabled = false;
  }
});

document.getElementById('verify-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('verify-submit').click();
  }
});

// ── Passwort vergessen ──
let forgotUsername = '';
let forgotCode = '';

function showForgotOverlay() {
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  tabLogin.classList.add('hidden');
  tabRegister.classList.add('hidden');
  formTitle.textContent = 'Passwort vergessen';
  document.querySelector('.login-card').classList.add('hidden');
  document.getElementById('forgot-overlay').classList.remove('hidden');
  document.getElementById('forgot-step1').classList.remove('hidden');
  document.getElementById('forgot-step2').classList.add('hidden');
  document.getElementById('forgot-step3').classList.add('hidden');
  document.getElementById('forgot-step4').classList.add('hidden');
  document.getElementById('forgot-username').value = '';
  document.getElementById('forgot-error1').textContent = '';
  setTimeout(() => document.getElementById('forgot-username').focus(), 100);
}

function showForgotStep(n) {
  for (var i = 1; i <= 4; i++) {
    var el = document.getElementById('forgot-step' + i);
    if (el) el.classList.toggle('hidden', i !== n);
  }
}

document.getElementById('show-forgot-password')?.addEventListener('click', (e) => {
  e.preventDefault();
  showForgotOverlay();
});

document.getElementById('forgot-back-login')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgot-overlay').classList.add('hidden');
  document.querySelector('.login-card').classList.remove('hidden');
  loginForm.classList.remove('hidden');
  tabLogin.classList.remove('hidden');
  tabRegister.classList.remove('hidden');
  formTitle.textContent = t('welcomeBack');
  document.getElementById('forgot-error1').textContent = '';
});

document.getElementById('forgot-submit1')?.addEventListener('click', async () => {
  const username = document.getElementById('forgot-username').value.trim();
  const errorEl = document.getElementById('forgot-error1');
  errorEl.textContent = '';
  if (!username) { errorEl.textContent = 'Benutzername erforderlich.'; return; }

  const btn = document.getElementById('forgot-submit1');
  btn.textContent = '...'; btn.disabled = true;
  try {
    const result = await window.api.forgotPassword(username);
    if (!result.ok) { errorEl.textContent = result.error; return; }
    forgotUsername = username;
    document.getElementById('forgot-email-masked').textContent = result.maskedEmail;
    document.getElementById('forgot-code').value = '';
    document.getElementById('forgot-dev-code').style.display = 'none';
    if (result.devMode && result.code) {
      document.getElementById('forgot-dev-code').style.display = 'block';
      document.getElementById('forgot-dev-code').textContent = 'Dev-Code: ' + result.code;
    }
    showForgotStep(2);
    setTimeout(() => document.getElementById('forgot-code').focus(), 100);
  } finally {
    btn.textContent = 'Code senden'; btn.disabled = false;
  }
});

document.getElementById('forgot-submit2')?.addEventListener('click', async () => {
  const code = document.getElementById('forgot-code').value.trim();
  const errorEl = document.getElementById('forgot-error2');
  errorEl.textContent = '';
  if (!code || code.length !== 6) { errorEl.textContent = '6-stelliger Code erforderlich.'; return; }

  if (!forgotUsername) { errorEl.textContent = 'Fehler: Kein Benutzername gesetzt.'; return; }

  forgotCode = code;
  document.getElementById('forgot-new-password').value = '';
  showForgotStep(3);
  setTimeout(() => document.getElementById('forgot-new-password').focus(), 100);
});

document.getElementById('forgot-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('forgot-submit2')?.click();
});

document.getElementById('forgot-resend-code')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!forgotUsername) return;
  const errorEl = document.getElementById('forgot-error2');
  errorEl.textContent = '';
  const link = document.getElementById('forgot-resend-code');
  link.textContent = '...'; link.style.pointerEvents = 'none';
  try {
    const result = await window.api.resendResetCode(forgotUsername);
    if (result.ok) {
      document.getElementById('forgot-dev-code').style.display = 'none';
      if (result.devMode && result.code) {
        document.getElementById('forgot-dev-code').style.display = 'block';
        document.getElementById('forgot-dev-code').textContent = 'Dev-Code: ' + result.code;
      }
      errorEl.textContent = result.devMode ? 'E-Mail konnte nicht gesendet werden. Siehe Dev-Code.' : 'Code erneut gesendet!';
      errorEl.style.color = '#3ba55d';
      setTimeout(() => { errorEl.textContent = ''; errorEl.style.color = ''; }, 4000);
    } else {
      errorEl.textContent = result.error || 'Fehler';
    }
  } finally {
    link.textContent = 'Code erneut senden'; link.style.pointerEvents = '';
  }
});

document.getElementById('forgot-submit3')?.addEventListener('click', async () => {
  const pw = document.getElementById('forgot-new-password').value;
  const pw2 = document.getElementById('forgot-new-password2').value;
  const errorEl = document.getElementById('forgot-error3');
  errorEl.textContent = '';

  if (!pw || pw.length < 1) { errorEl.textContent = 'Passwort darf nicht leer sein.'; return; }
  if (pw !== pw2) { errorEl.textContent = 'Passwoerter stimmen nicht ueberein.'; return; }

  if (!forgotCode) { errorEl.textContent = 'Code fehlt. Bitte neu beginnen.'; return; }

  const btn = document.getElementById('forgot-submit3');
  btn.textContent = '...'; btn.disabled = true;
  try {
    const result = await window.api.resetPassword(forgotUsername, forgotCode, pw);
    if (!result.ok) { errorEl.textContent = result.error; return; }
    showForgotStep(4);
  } finally {
    btn.textContent = 'Passwort aendern'; btn.disabled = false;
  }
});

document.getElementById('forgot-new-password2')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('forgot-submit3')?.click();
});

document.getElementById('forgot-goto-login')?.addEventListener('click', () => {
  document.getElementById('forgot-overlay').classList.add('hidden');
  document.querySelector('.login-card').classList.remove('hidden');
  loginForm.classList.remove('hidden');
  tabLogin.classList.remove('hidden');
  tabRegister.classList.remove('hidden');
  formTitle.textContent = t('welcomeBack');
  forgotUsername = '';
  forgotCode = '';
});
