window.onerror = function(msg, src, line, col, err) {
  console.error('[JS Error]', msg, src, line, col, err);
  return false;
};
window.onunhandledrejection = function(e) {
  console.error('[Unhandled Rejection]', e.reason);
};

const userId = localStorage.getItem('currentUserId');
if (!userId) window.location.href = 'login.html';

let currentUser = null;
let currentServer = null;
let currentChannel = null;
let currentView = 'home';
let currentDM = null;
let allServers = [];
let authorNameCache = {};
let authorAvatarCache = {};
let authorBannerCache = {};
let authorStatusCache = {};
let ssIsOwner = false;
let unreadDMs = {};
let lastSeenTimestamps = {};
let lastChannelMsgCount = {};
let lastDMPollCount = 0;
let notifAudioCtx = null;

function playDMNotification() {
  try {
    if (!notifAudioCtx) notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = notifAudioCtx;
    var now = ctx.currentTime;
    var osc1 = ctx.createOscillator();
    var osc2 = ctx.createOscillator();
    var gain = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(1174.66, now + 0.08);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, now + 0.08);
    osc2.frequency.setValueAtTime(1760, now + 0.16);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch(e) {}
}

function showToast(title, message, avatarSrc) {
  var toast = document.createElement('div');
  toast.className = 'dm-toast';
  toast.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px">' +
      (avatarSrc ? '<img src="' + avatarSrc + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0" />' : '') +
      '<div style="flex:1;overflow:hidden">' +
        '<div style="font-weight:600;font-size:14px;color:#fff">' + escHtml(title) + '</div>' +
        '<div style="font-size:13px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(message) + '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.classList.add('show'); });
  toast.addEventListener('click', function() {
    toast.remove();
    document.getElementById('dm-btn')?.click();
  });
  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
  }, 5000);
}

function updateDMBadge() {
  var count = Object.keys(unreadDMs).filter(function(k) { return unreadDMs[k]; }).length;
  var badge = document.getElementById('dm-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'dm-badge';
      badge.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#f23f43;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;pointer-events:none;z-index:10;border:2px solid var(--bg-rail)';
      var dmBtn = document.getElementById('dm-btn');
      if (dmBtn) { dmBtn.style.position = 'relative'; dmBtn.appendChild(badge); }
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else if (badge) {
    badge.remove();
  }
}

function toFileUrl(p) { return window.api?.toFileUrl?.(p) || (p ? 'file://' + p.replace(/\\/g, '/') : ''); }

function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = 0;
  var size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return (i === 0 ? size : size.toFixed(1)) + ' ' + units[i];
}

function getFileIcon(name) {
  if (!name) return '📄';
  var ext = (name.split('.').pop() || '').toLowerCase();
  var icons = {
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
    txt: '📝', md: '📝', csv: '📝', json: '📝', xml: '📝',
    js: '📜', ts: '📜', py: '📜', java: '📜', cpp: '📜', c: '📜', h: '📜',
    exe: '⚙️', msi: '⚙️', dmg: '⚙️',
    mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', m4a: '🎵',
    mp4: '🎬', webm: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️', svg: '🖼️',
    psd: '🎨', ai: '🎨', sketch: '🎨',
  };
  return icons[ext] || '📄';
}

function openLightbox(url, name, kind) {
  var overlay = document.getElementById('media-lightbox');
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.style.display = 'flex';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'lb-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = function() { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  overlay.appendChild(closeBtn);

  var dlBtn = document.createElement('button');
  dlBtn.className = 'lb-download';
  dlBtn.textContent = name || 'Download';
  dlBtn.onclick = function() { if (window.api?.downloadFile) window.api.downloadFile(url, name); };
  overlay.appendChild(dlBtn);

  if (kind === 'image') {
    var img = document.createElement('img');
    img.className = 'lb-content';
    img.src = toFileUrl(url);
    img.alt = name || '';
    overlay.appendChild(img);
  } else if (kind === 'video') {
    var vid = document.createElement('video');
    vid.className = 'lb-content';
    vid.src = toFileUrl(url);
    vid.controls = true;
    vid.autoplay = true;
    overlay.appendChild(vid);
  }
  overlay.onclick = function(e) { if (e.target === overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; } };
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { overlay.style.display = 'none'; overlay.innerHTML = ''; document.removeEventListener('keydown', handler); }
  });
}

function renderAttachmentHTML(att) {
  var url = att.path;
  var name = att.name || '';
  var size = att.size;

  if (att.kind === 'image') {
    return '<div class="msg-attachment msg-att-image" data-att-url="' + escHtml(url) + '" data-att-name="' + escHtml(name) + '" data-att-kind="image">' +
      '<img src="' + toFileUrl(url) + '" alt="' + escHtml(name) + '" loading="lazy" />' +
      '<div class="att-overlay"><button class="att-dl-btn" data-dl-url="' + escHtml(url) + '" data-dl-name="' + escHtml(name) + '" title="' + escHtml(name) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +
      '</div>';
  }
  if (att.kind === 'video') {
    return '<div class="msg-attachment msg-att-video">' +
      '<video src="' + toFileUrl(url) + '" controls preload="metadata"></video>' +
      '<div class="att-overlay"><button class="att-dl-btn att-dl-fullscreen" data-dl-url="' + escHtml(url) + '" data-dl-name="' + escHtml(name) + '" data-att-kind="video" title="Vollbild"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<button class="att-dl-btn" data-dl-url="' + escHtml(url) + '" data-dl-name="' + escHtml(name) + '" title="Herunterladen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +
      '</div>';
  }
  if (att.kind === 'audio') {
    return '<div class="msg-attachment msg-att-audio">' +
      '<div class="att-audio-icon">🎵</div>' +
      '<div class="att-audio-info"><div class="att-audio-name">' + escHtml(name || 'Audio') + '</div>' +
      (size ? '<div class="att-audio-size">' + formatFileSize(size) + '</div>' : '') +
      '</div>' +
      '<audio src="' + toFileUrl(url) + '" controls preload="metadata"></audio>' +
      '<button class="att-dl-btn" data-dl-url="' + escHtml(url) + '" data-dl-name="' + escHtml(name) + '" title="Herunterladen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '</div>';
  }
  return '<div class="msg-attachment msg-att-file">' +
    '<div class="att-file-icon">' + getFileIcon(name) + '</div>' +
    '<div class="att-file-info"><div class="att-file-name">' + escHtml(name || t('file')) + '</div>' +
    (size ? '<div class="att-file-size">' + formatFileSize(size) + '</div>' : '') +
    '</div>' +
    '<button class="att-dl-btn" data-dl-url="' + escHtml(url) + '" data-dl-name="' + escHtml(name) + '" title="Herunterladen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
    '</div>';
}

function defaultAvatar(letter) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#5865f2"/><text x="32" y="40" font-size="24" fill="#fff" text-anchor="middle" font-family="sans-serif">' + escHtml(String(letter || '?')[0]) + '</text></svg>';
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function showEmojiPicker(msgId, anchorEl) {
  var existing = document.getElementById('emoji-picker-popup');
  if (existing) existing.remove();
  var emojis = ['👍','❤️','😂','😮','😢','😡','🎉','🔥','👀','💯','✅','❌','🤣','😍','🤔','👏','🙌','💪','🤝','💀','🫡','😍','🥳','😎','🫠','🫣','😡','🤡','💀','👻','🎃','🌟','⭐','💎','🎮','🎵','🎶','🖼️','📄','💾','🗑️'];
  var popup = document.createElement('div');
  popup.id = 'emoji-picker-popup';
  popup.style.cssText = 'position:fixed;z-index:9999;background:#2b2d31;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);padding:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:2px;max-width:320px';
  emojis.forEach(function(e) {
    var btn = document.createElement('button');
    btn.textContent = e;
    btn.style.cssText = 'border:none;background:none;font-size:20px;cursor:pointer;padding:4px;border-radius:4px;line-height:1';
    btn.onmouseenter = function() { btn.style.background = 'rgba(255,255,255,0.1)'; };
    btn.onmouseleave = function() { btn.style.background = 'none'; };
    btn.addEventListener('click', async function(ev) {
      ev.stopPropagation();
      popup.remove();
      await window.api.messagesReact(msgId, e, userId);
      if (currentView === 'dm' && currentDM) await loadDMMessages();
      else if (currentChannel) await loadMessages();
    });
    popup.appendChild(btn);
  });
  document.body.appendChild(popup);
  var rect = anchorEl.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, window.innerWidth - 330) + 'px';
  popup.style.top = (rect.top - popup.offsetHeight - 4) + 'px';
  if (parseInt(popup.style.top) < 0) popup.style.top = (rect.bottom + 4) + 'px';
  setTimeout(function() {
    document.addEventListener('click', function closePicker(ev) {
      if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('click', closePicker); }
    }, { once: true });
  }, 10);
}

function getMemberAvatar(authorId) {
  if (authorId === currentUser?.id && currentUser?.avatarPath) return toFileUrl(currentUser.avatarPath);
  for (const s of allServers) {
    if (!s.members) continue;
    const m = s.members.find((mem) => (mem.id || mem.userId) === authorId);
    if (m?.avatarPath) return toFileUrl(m.avatarPath);
  }
  return null;
}

function cacheUserData(user) {
  if (!user || !user.id) return;
  if (user.username) authorNameCache[user.id] = user.username;
  if (user.avatarPath) authorAvatarCache[user.id] = user.avatarPath;
  if (user.bannerPath) authorBannerCache[user.id] = user.bannerPath;
  if (user.status) authorStatusCache[user.id] = user.status;
}

function getAuthorAvatarSync(authorId) {
  if (authorId === currentUser?.id && currentUser?.avatarPath) return toFileUrl(currentUser.avatarPath);
  if (authorAvatarCache[authorId]) return toFileUrl(authorAvatarCache[authorId]);
  for (const s of allServers) {
    if (!s.members) continue;
    const m = s.members.find((mem) => (mem.id || mem.userId) === authorId);
    if (m?.avatarPath) { authorAvatarCache[authorId] = m.avatarPath; return toFileUrl(m.avatarPath); }
  }
  return null;
}

async function getAuthorAvatar(authorId) {
  const cached = getAuthorAvatarSync(authorId);
  if (cached) return cached;
  try {
    const result = await window.api.getUserById(authorId);
    if (result?.ok && result.user) {
      cacheUserData(result.user);
      if (result.user.avatarPath) return toFileUrl(result.user.avatarPath);
    }
  } catch {}
  const name = getAuthorNameSync(authorId);
  return defaultAvatar(name[0] || '?');
}

function getMemberById(id) {
  if (id === currentUser?.id) return currentUser;
  for (const s of allServers) {
    if (!s.members) continue;
    const m = s.members.find(function(mem) {
      if (typeof mem === 'string') return mem === id;
      return (mem.id || mem.userId) === id;
    });
    if (m) return typeof m === 'string' ? null : m;
  }
  return null;
}

function getAuthorRole(authorId) {
  if (!currentServer?.roles || !authorId) return null;
  for (const role of currentServer.roles) {
    if (role.memberIds?.includes(authorId)) return role;
  }
  return null;
}

function getAuthorNameSync(authorId) {
  if (!authorId) return t('unknown');
  if (authorNameCache[authorId]) return authorNameCache[authorId];
  if (currentUser?.id === authorId) { authorNameCache[authorId] = currentUser.username; return currentUser.username; }
  for (const s of allServers) {
    if (!s.members) continue;
    for (const m of s.members) {
      if ((m.id || m.userId) === authorId && m.username) {
        authorNameCache[authorId] = m.username;
        return m.username;
      }
    }
  }
  return authorId.substring(0, 8);
}

async function getAuthorName(authorId) {
  if (!authorId) return t('unknown');
  if (authorNameCache[authorId]) return authorNameCache[authorId];
  const sync = getAuthorNameSync(authorId);
  if (sync !== authorId.substring(0, 8)) return sync;
  try {
    const result = await window.api.getUserById(authorId);
    if (result?.ok && result.user?.username) {
      authorNameCache[authorId] = result.user.username;
      cacheUserData(result.user);
      return result.user.username;
    }
  } catch {}
  return authorId.substring(0, 8);
}

function buildAuthorCacheFromServers() {
  for (const s of allServers) {
    if (!s.members) continue;
    for (const m of s.members) {
      const id = m.id || m.userId;
      if (id && m.username) authorNameCache[id] = m.username;
      if (id && m.avatarPath) authorAvatarCache[id] = m.avatarPath;
      if (id && m.bannerPath) authorBannerCache[id] = m.bannerPath;
      if (id && m.status) authorStatusCache[id] = m.status;
    }
  }
}

function ensureElement(id, parent, tag, className, innerHTML) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement(tag || 'div');
  el.id = id;
  if (className) el.className = className;
  if (innerHTML) el.innerHTML = innerHTML;
  (parent || document.body).appendChild(el);
  return el;
}

function ensureMembersSidebar() {
  let sidebar = document.getElementById('members-sidebar');
  if (sidebar) return sidebar;
  const chatArea = document.querySelector('.chat-area');
  if (!chatArea?.parentNode) return null;
  sidebar = document.createElement('div');
  sidebar.id = 'members-sidebar';
  sidebar.className = 'members-sidebar hidden';
  chatArea.parentNode.insertBefore(sidebar, chatArea.nextSibling);
  return sidebar;
}

function ensureContextMenu() {
  return ensureElement('context-menu', null, 'div', 'context-menu hidden');
}

function ensureProfilePopup() {
  return ensureElement('profile-popup-overlay', null, 'div', 'profile-popup-overlay hidden');
}

function ensureStatusDot() {
  return document.getElementById('user-status-dot');
}

function ensureMembersToggle() {
  const header = document.getElementById('chat-header');
  if (!header || document.getElementById('toggle-members')) return;
  const actions = header.querySelector('.chat-header-actions');
  if (!actions) return;
  const btn = document.createElement('button');
  btn.className = 'header-btn';
  btn.id = 'toggle-members';
  btn.title = t('toggleMembers');
  btn.textContent = '\uD83D\uDC65';
  actions.insertBefore(btn, actions.firstChild);
}

// ── Profile laden ──
async function loadProfile() {
  const result = await window.api.getProfile(userId);
  if (!result?.ok) { window.location.href = 'login.html'; return; }
  currentUser = result.user;
  cacheUserData(result.user);
  applyProfileToUI();
  checkEmailVerification();
}

function checkEmailVerification() {
  if (!currentUser || currentUser.emailVerified || !currentUser.email) return;
  const banner = document.getElementById('email-verify-banner');
  if (banner) {
    banner.style.display = 'flex';
    document.getElementById('verify-banner-text').textContent = t('emailNotVerified');
  }
  const overlay = document.getElementById('email-verify-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.getElementById('app-verify-email').textContent = currentUser.email || '';
    document.getElementById('app-verify-code').value = '';
    document.getElementById('app-verify-error').textContent = '';
    document.getElementById('app-verify-dev-code').style.display = 'none';
    setTimeout(() => document.getElementById('app-verify-code')?.focus(), 100);
    window.api.emailResend(userId).then(function(r) {
      if (r.ok && r.code) {
        document.getElementById('app-verify-dev-code').style.display = 'block';
        document.getElementById('app-verify-dev-code').textContent = t('devModeCode') + r.code;
      }
    });
  }
}

document.getElementById('verify-banner-btn')?.addEventListener('click', () => {
  const overlay = document.getElementById('email-verify-overlay');
  if (overlay) { overlay.style.display = 'flex'; }
  document.getElementById('app-verify-email').textContent = currentUser?.email || '';
  document.getElementById('app-verify-code').value = '';
  document.getElementById('app-verify-error').textContent = '';
  setTimeout(() => document.getElementById('app-verify-code')?.focus(), 100);
});

document.getElementById('verify-banner-dismiss')?.addEventListener('click', () => {
  const banner = document.getElementById('email-verify-banner');
  if (banner) { banner.style.display = 'none'; }
});

function closeVerifyOverlay() {
  const overlay = document.getElementById('email-verify-overlay');
  if (overlay) overlay.style.display = 'none';
  const banner = document.getElementById('email-verify-banner');
  if (banner) banner.style.display = 'none';
}

document.getElementById('app-verify-submit')?.addEventListener('click', async () => {
  const code = document.getElementById('app-verify-code').value.trim();
  const errorEl = document.getElementById('app-verify-error');
  errorEl.textContent = '';
  if (!code || code.length !== 6) { errorEl.textContent = t('sixDigitCode'); return; }
  const btn = document.getElementById('app-verify-submit');
  btn.disabled = true; btn.textContent = '...';
  try {
    const result = await window.api.emailVerify(userId, code);
    btn.disabled = false; btn.textContent = 'Verifizieren';
    if (!result || !result.ok) { errorEl.textContent = (result && result.error) || 'Fehler'; return; }
    currentUser.emailVerified = true;
    closeVerifyOverlay();
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Verifizieren';
    errorEl.textContent = 'Fehler: ' + e.message;
    console.error('[EmailVerify]', e);
  }
});

document.getElementById('app-verify-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('app-verify-submit')?.click();
});

document.getElementById('app-verify-resend')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('app-verify-error');
  errorEl.textContent = '';
  const btn = document.getElementById('app-verify-resend');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const result = await window.api.emailResend(userId);
    if (result.ok) {
      if (result.code) {
        document.getElementById('app-verify-dev-code').style.display = 'block';
        document.getElementById('app-verify-dev-code').textContent = t('devModeCode') + result.code;
      }
      if (result.devMode) {
        errorEl.textContent = t('emailSendFailed');
        errorEl.style.color = '#faa61a';
      } else {
        errorEl.textContent = t('codeSentTo') + ' ' + currentUser.email;
        errorEl.style.color = '#3ba55d';
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

document.getElementById('app-verify-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('app-verify-submit').click();
});

document.getElementById('app-verify-logout')?.addEventListener('click', () => {
  localStorage.removeItem('currentUserId');
  window.location.href = 'login.html';
});

function applyProfileToUI() {
  if (!currentUser) return;
  var activeTheme = _pendingChanges.theme !== undefined ? _pendingChanges.theme : (currentUser.theme || 'dark');
  document.body.dataset.theme = activeTheme;
  const avatarUrl = currentUser.avatarPath ? toFileUrl(currentUser.avatarPath) : defaultAvatar((currentUser.username || '?')[0]);
  const userAvatar = document.getElementById('user-avatar');
  if (userAvatar) userAvatar.src = avatarUrl;
  const userName = document.getElementById('user-name');
  if (userName) userName.textContent = currentUser.username;
  const mobileUserName = document.getElementById('mobile-user-name');
  if (mobileUserName) mobileUserName.textContent = currentUser.username;
  const mobileUserAvatar = document.getElementById('mobile-user-avatar');
  if (mobileUserAvatar) mobileUserAvatar.src = avatarUrl;
  const userRarity = document.getElementById('user-rarity');
  if (userRarity) userRarity.textContent = currentUser.rarityLabel;

  // Discord-style status dot + text
  var statusColors = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e' };
  var statusLabels = { online: 'Online', idle: 'Abwesend', dnd: 'Nicht stoeren', invisible: 'Unsichtbar' };
  var curStatus = currentUser.status || 'online';
  var dot = document.getElementById('user-status-dot');
  if (dot) dot.style.background = statusColors[curStatus] || statusColors.online;
  var statusText = document.getElementById('user-status-text');
  if (statusText) statusText.textContent = currentUser.aboutMe || statusLabels[curStatus] || '';

  const profileAvatar = document.getElementById('profile-avatar');
  if (profileAvatar) profileAvatar.src = avatarUrl;
  const profileUsername = document.getElementById('profile-username');
  if (profileUsername) profileUsername.textContent = currentUser.username;
  const rarityTag = document.getElementById('profile-rarity-tag');
  if (rarityTag) { rarityTag.textContent = currentUser.rarityLabel; rarityTag.className = 'rarity-tag rarity-' + currentUser.rarityKey; }
  const banner = document.getElementById('profile-banner');
  if (banner) banner.style.backgroundImage = currentUser.bannerPath ? 'url("' + toFileUrl(currentUser.bannerPath) + '")' : 'none';
  const aboutMe = document.getElementById('about-me');
  if (aboutMe && document.activeElement !== aboutMe) aboutMe.value = currentUser.aboutMe || '';
  const profileCreated = document.getElementById('profile-created');
  if (profileCreated) profileCreated.textContent = new Date(currentUser.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: 'long', year: 'numeric' });
  if (currentUser.is_owner || currentUser.is_admin) {
    const adminEntry = document.getElementById('admin-entry');
    if (adminEntry) adminEntry.classList.remove('hidden');
    const openAdmin = document.getElementById('open-admin-panel');
    if (openAdmin) openAdmin.style.display = 'block';
  }
  applyStatusDot();
  applyBackground();
}

function applyStatusDot() {
  const dot = document.getElementById('user-status-dot');
  if (!dot || !currentUser) return;
  const colors = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e' };
  dot.style.backgroundColor = colors[currentUser.status || 'online'] || colors.online;
}

function applyBackground() {
  const bgImg = document.getElementById('bg-image');
  const bgVid = document.getElementById('bg-video');
  if (!bgImg || !bgVid) return;
  bgImg.classList.remove('showing');
  bgVid.classList.remove('showing');
  bgVid.pause();
  const soundRow = document.getElementById('bg-sound-row');
  if (soundRow) soundRow.classList.add('hidden');
  var bgPath = _pendingChanges.backgroundPath !== undefined ? _pendingChanges.backgroundPath : currentUser?.backgroundPath;
  var bgKind = _pendingChanges.backgroundKind !== undefined ? _pendingChanges.backgroundKind : currentUser?.backgroundKind;
  var bgSound = _pendingChanges.backgroundSound !== undefined ? _pendingChanges.backgroundSound : currentUser?.backgroundSound;
  if (!bgPath) {
    document.getElementById('app-background')?.classList.remove('active');
    document.body.classList.remove('has-bg');
    return;
  }
  document.body.classList.add('has-bg');
  document.getElementById('app-background')?.classList.add('active');
  if (bgKind === 'video') {
    bgVid.src = toFileUrl(bgPath);
    bgVid.muted = !bgSound;
    bgVid.classList.add('showing');
    bgVid.play().catch(() => {});
    if (soundRow) soundRow.classList.remove('hidden');
    const toggle = document.getElementById('bg-sound-toggle');
    if (toggle) toggle.checked = !!bgSound;
  } else {
    bgImg.src = toFileUrl(bgPath);
    bgImg.classList.add('showing');
  }
  var bgBlur = _pendingChanges.backgroundBlur !== undefined ? _pendingChanges.backgroundBlur : (currentUser?.backgroundBlur || 0);
  applyBackgroundBlur(bgBlur);
}

function applyBackgroundBlur(blur) {
  var bgImg = document.getElementById('bg-image');
  var bgVid = document.getElementById('bg-video');
  if (bgImg) bgImg.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : '';
  if (bgVid) bgVid.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : '';
}

// ── Status Selector ──
function showStatusSelector() {
  let popup = document.getElementById('status-selector');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'status-selector';
    popup.className = 'status-selector';
    popup.innerHTML = '<div class="status-option" data-status="online"><span class="status-dot-inline" style="background:#3ba55d"></span> ' + t('online') + '</div>' +
      '<div class="status-option" data-status="idle"><span class="status-dot-inline" style="background:#f0b232"></span> ' + t('idle') + '</div>' +
      '<div class="status-option" data-status="dnd"><span class="status-dot-inline" style="background:#ed4245"></span> ' + t('dnd') + '</div>' +
      '<div class="status-option" data-status="invisible"><span class="status-dot-inline" style="background:#80848e"></span> ' + t('invisible') + '</div>';
    document.body.appendChild(popup);
  }
  const dot = document.getElementById('status-dot');
  if (dot) {
    const rect = dot.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.top = 'auto';
  }
  popup.classList.remove('hidden');
  popup.querySelectorAll('.status-option').forEach((opt) => {
    opt.onclick = async () => {
      const result = await window.api.updateProfile(userId, { status: opt.dataset.status });
      if (result?.ok) { currentUser = result.user; applyStatusDot(); }
      popup.classList.add('hidden');
    };
  });
  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'status-dot' && !e.target.closest('#status-dot')) {
        popup.classList.add('hidden');
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler);
  }, 0);
}

// ── Server laden ──
async function loadServers() {
  allServers = (await window.api.serverGetForUser(currentUser.id)) || [];
  buildAuthorCacheFromServers();
  renderServerRail();
}

function renderServerRail() {
  const rail = document.getElementById('server-rail');
  if (!rail) return;
  rail.querySelectorAll('.server-icon.server-item').forEach((el) => el.remove());
  const addBtn = document.getElementById('add-server');
  allServers.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'server-icon server-item' + (currentServer?.id === s.id ? ' active' : '');
    el.title = s.name;
    if (s.icon) {
      const img = document.createElement('img');
      img.src = toFileUrl(s.icon);
      img.alt = s.name;
      img.style.cssText = 'width:100%;height:100%;border-radius:inherit;object-fit:cover';
      el.appendChild(img);
    } else {
      el.textContent = s.name.substring(0, 2).toUpperCase();
    }
    el.addEventListener('click', () => selectServer(s));
    rail.insertBefore(el, addBtn);
  });
}

async function selectServer(server) {
  closeMobileMenu();
  try {
    const full = await window.api.serverGetById(server.id);
    if (full?.ok) server = full.server || full;
  } catch {}
  currentServer = server;
  currentView = 'server';
  currentDM = null;
  document.getElementById('home-btn')?.classList.remove('active');
  document.getElementById('dm-btn')?.classList.remove('active');
  document.querySelectorAll('.server-icon.server-item').forEach((el) => el.classList.remove('active'));
  renderServerRail();
  const sh = document.getElementById('server-header');
  if (sh) sh.textContent = server.name;
  document.getElementById('server-channels')?.classList.remove('hidden');
  document.getElementById('dm-list')?.classList.add('hidden');
  document.getElementById('server-settings-btn')?.classList.remove('hidden');
  document.getElementById('toggle-members')?.classList.remove('hidden');
  hideDMCallButtons();
  renderChannels();
  if (window.innerWidth > 768) showMembersSidebar();
  else hideMembersSidebar();
  if (server.channels?.length > 0) selectChannel(server.channels[0]);
}

function renderChannels() {
  const group = document.getElementById('channel-group');
  if (!group) return;
  group.innerHTML = '';
  if (!currentServer?.channels) return;
  const textChannels = currentServer.channels.filter((ch) => ch.type !== 'voice');
  const voiceChannels = currentServer.channels.filter((ch) => ch.type === 'voice');
  if (textChannels.length > 0) {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = t('textChannels');
    group.appendChild(label);
    textChannels.forEach((ch) => {
      const el = document.createElement('div');
      el.className = 'channel' + (currentChannel?.id === ch.id ? ' active' : '');
      el.textContent = '# ' + ch.name;
      el.addEventListener('click', () => selectChannel(ch));
      group.appendChild(el);
    });
  }
  if (voiceChannels.length > 0) {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = t('voiceChannels');
    group.appendChild(label);
    voiceChannels.forEach((ch) => {
      const vState = window.__voiceChannelState || {};
      const usersInChannel = vState[ch.id] || [];
      const isInThis = usersInChannel.includes(userId);
      const el = document.createElement('div');
      el.className = 'voice-channel-item' + (isInThis ? ' active' : '');
      el.innerHTML = '<div class="voice-channel-header" data-ch-id="' + ch.id + '">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.5"><path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<span class="voice-channel-name">' + escHtml(ch.name) + '</span>' +
        (isInThis ? '<button class="voice-leave-btn" title="Channel verlassen" data-ch-id="' + ch.id + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : '') +
        '</div>';
      const headerEl = el.querySelector('.voice-channel-header');
      if (headerEl) {
        headerEl.addEventListener('click', function (e) {
          if (e.target.closest('.voice-leave-btn')) return;
          if (isInThis) return;
          window.joinVoiceChannel(ch.id);
          el.classList.add('active');
        });
      }
      const leaveBtn = el.querySelector('.voice-leave-btn');
      if (leaveBtn) {
        leaveBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          window.leaveVoiceChannel();
        });
      }
      if (usersInChannel.length > 0) {
        const usersEl = document.createElement('div');
        usersEl.className = 'voice-users-list';
        usersInChannel.forEach(function (uid) {
          const entry = document.createElement('div');
          entry.className = 'voice-user-entry';
          entry.dataset.voiceUserId = uid;
          const uname = authorNameCache[uid] || '...';
          const uavatar = authorAvatarCache[uid] || '';
          entry.innerHTML = '<img class="voice-user-avatar" src="' + escHtml(uavatar || defaultAvatar(uname[0] || '?')) + '" alt="" /><span class="voice-user-name">' + escHtml(uname) + '</span>';
          entry.addEventListener('click', () => {
            if (uid === userId) return;
          });
          usersEl.appendChild(entry);
        });
        el.appendChild(usersEl);
      }
      group.appendChild(el);
    });
  }
}

window.renderVoiceChannels = function () {
  if (currentView === 'server' && currentServer) renderChannels();
};

async function selectChannel(channel) {
  closeMobileMenu();
  currentChannel = channel;
  if (channel.type === 'voice') {
    document.getElementById('chat-header')?.classList.remove('hidden');
    document.getElementById('chat-input-wrapper')?.classList.add('hidden');
    const cc = document.getElementById('current-channel');
    if (cc) cc.textContent = channel.name;
    renderChannels();
    const messagesEl = document.getElementById('messages');
    if (messagesEl) {
      messagesEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;opacity:0.4"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p style="margin-top:12px;font-size:14px">' + t('voiceChannel') + '</p></div>';
    }
    return;
  }
  document.getElementById('chat-header')?.classList.remove('hidden');
  document.getElementById('chat-input-wrapper')?.classList.remove('hidden');
  const cc = document.getElementById('current-channel');
  if (cc) cc.textContent = '# ' + channel.name;
  const msgInput = document.getElementById('message-input');
  if (msgInput) msgInput.placeholder = t('messageTo') + ' #' + channel.name;
  document.getElementById('server-settings-btn')?.classList.remove('hidden');
  document.getElementById('toggle-members')?.classList.remove('hidden');
  renderChannels();
  await loadMessages();
  if (window.innerWidth > 768) showMembersSidebar();
  else hideMembersSidebar();
}

// ── Nachrichten laden ──
async function loadMessages() {
  if (!currentChannel) return;
  const msgs = (await window.api.messagesGet(currentChannel.id)) || [];
  lastChannelMsgCount[currentChannel.id] = msgs.length;
  renderMessages(msgs);
}

// ── Helpers: optimistic message render ──
function appendMessage(m) {
  const list = document.getElementById('messages');
  if (!list) return;
  const authorId = m.authorId || m.userId;
  const name = getAuthorNameSync(authorId);
  const avatar = getAuthorAvatarSync(authorId) || defaultAvatar(name[0] || '?');
  const date = new Date(m.timestamp);
  const timeStr = date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  const el = document.createElement('div');
  el.className = 'msg';
  el.dataset.msgId = m.id;
  el.dataset.authorId = authorId;
  let attHtml = '';
  if (m.attachments && m.attachments.length > 0) {
    attHtml = '<div class="msg-attachments">';
    for (const a of m.attachments) {
      attHtml += renderAttachmentHTML(a);
    }
    attHtml += '</div>';
  }
  el.innerHTML = '<img class="msg-avatar" src="' + escHtml(avatar) + '" alt="" data-author-id="' + authorId + '" />' +
    '<div class="msg-body"><div class="msg-header"><span class="author" data-author-id="' + authorId + '">' + escHtml(name) + '</span><span class="msg-timestamp">' + timeStr + '</span></div>' +
    '<div class="msg-content" id="msg-content-' + m.id + '">' + escHtml(m.content || '') + '</div>' + attHtml + '</div>';
  list.appendChild(el);
}

function scrollMessagesToBottom() {
  const list = document.getElementById('messages');
  if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function renderMessages(msgs) {
  const list = document.getElementById('messages');
  if (!list) return;
  list.innerHTML = '';
  let lastAuthor = null;
  let lastTime = 0;
  let lastDate = '';

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const msgDate = new Date(m.timestamp);
    const dateStr = msgDate.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = msgDate.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
    const fullTimeStr = msgDate.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + timeStr;

    if (dateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let label = dateStr;
      if (dateStr === today.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })) label = t('today');
      else if (dateStr === yesterday.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })) label = t('yesterday');
      sep.innerHTML = '<span>' + label + '</span>';
      list.appendChild(sep);
      lastDate = dateStr;
      lastAuthor = null;
      lastTime = 0;
    }

    const isGrouped = lastAuthor === m.authorId && (m.timestamp - lastTime) < 420000;
    lastAuthor = m.authorId;
    lastTime = m.timestamp;

    const authorName = getAuthorNameSync(m.authorId);
    const role = getAuthorRole(m.authorId);
    const roleColor = role?.color || 'var(--text-main)';
    const avatarSrc = getAuthorAvatarSync(m.authorId) || defaultAvatar(authorName[0]);

    const div = document.createElement('div');
    div.className = 'msg' + (isGrouped ? ' grouped' : '');
    div.dataset.msgId = m.id;
    div.dataset.authorId = m.authorId;

    let reactionsHtml = '';
    if (m.reactions?.length > 0) {
      reactionsHtml = '<div class="msg-reactions">' + m.reactions.map(function(r) {
        var mine = r.userIds?.includes(userId) ? ' mine' : '';
        return '<span class="msg-reaction' + mine + '" data-msgid="' + m.id + '" data-emoji="' + r.emoji + '">' + r.emoji + ' <span>' + (r.userIds?.length || 0) + '</span></span>';
      }).join('') + '</div>';
    }

    let attachmentsHtml = '';
    if (m.attachments?.length > 0) {
      attachmentsHtml = '<div class="msg-attachments">' + m.attachments.map(function(att) {
        return renderAttachmentHTML(att);
      }).join('') + '</div>';
    }

    const editedTag = m.edited ? ' <span class="msg-edited">' + t('edited') + '</span>' : '';

    if (isGrouped) {
      div.innerHTML =
        '<div class="msg-hover-time">' + timeStr + '</div>' +
        '<div class="msg-body">' +
          '<div class="msg-content" id="msg-content-' + m.id + '">' + escHtml(m.content) + editedTag + '</div>' +
          attachmentsHtml +
          reactionsHtml +
        '</div>' +
        '<div class="msg-actions">' +
          '<button class="msg-action-btn" data-action="react" title="' + t('reaction') + '">😀</button>' +
          (m.authorId === userId || currentUser?.is_admin ? '<button class="msg-action-btn" data-action="edit" title="' + t('edit') + '">✏️</button>' : '') +
          (m.authorId === userId || currentUser?.is_admin ? '<button class="msg-action-btn danger" data-action="delete" title="' + t('delete') + '">🗑️</button>' : '') +
        '</div>';
    } else {
      div.innerHTML =
        '<img class="msg-avatar" src="' + avatarSrc + '" alt="" data-author-id="' + m.authorId + '" />' +
        '<div class="msg-body">' +
          '<div class="msg-header">' +
            '<span class="author" style="color:' + roleColor + '" data-author-id="' + m.authorId + '">' + escHtml(authorName) + '</span>' +
            '<span class="msg-timestamp" title="' + fullTimeStr + '">' + timeStr + '</span>' +
          '</div>' +
          '<div class="msg-content" id="msg-content-' + m.id + '">' + escHtml(m.content) + editedTag + '</div>' +
          attachmentsHtml +
          reactionsHtml +
        '</div>' +
        '<div class="msg-actions">' +
          '<button class="msg-action-btn" data-action="react" title="' + t('reaction') + '">😀</button>' +
          (m.authorId === userId || currentUser?.is_admin ? '<button class="msg-action-btn" data-action="edit" title="' + t('edit') + '">✏️</button>' : '') +
          (m.authorId === userId || currentUser?.is_admin ? '<button class="msg-action-btn danger" data-action="delete" title="' + t('delete') + '">🗑️</button>' : '') +
        '</div>';
    }
    list.appendChild(div);
  }

  list.scrollTop = list.scrollHeight;

  for (const m of msgs) {
    if (!authorNameCache[m.authorId] && m.authorId !== currentUser?.id) {
      const name = await getAuthorName(m.authorId);
      const authorEl = list.querySelector('[data-msg-id="' + m.id + '"] .author');
      if (authorEl && authorEl.textContent !== name) authorEl.textContent = name;
      const avatarEl = list.querySelector('[data-msg-id="' + m.id + '"] .msg-avatar');
      if (avatarEl && authorAvatarCache[m.authorId]) avatarEl.src = toFileUrl(authorAvatarCache[m.authorId]);
    }
  }
}

// ── Nachricht senden ──
let pendingAttachments = [];

document.getElementById('file-upload-btn')?.addEventListener('click', async () => {
  const result = await window.api.messagesPickFile();
  if (!result?.ok) return;
  pendingAttachments = pendingAttachments.concat(result.attachments);
  renderAttachmentPreview();
});

function renderAttachmentPreview() {
  const container = document.getElementById('attachment-preview');
  if (!container) return;
  container.innerHTML = '';
  pendingAttachments.forEach(function(att, i) {
    const item = document.createElement('div');
    item.className = 'msg-attachment-preview-item';
    if (att.kind === 'image') {
      item.innerHTML = '<img src="' + toFileUrl(att.path) + '" alt="" />' +
        '<button class="msg-attachment-preview-remove" data-idx="' + i + '">&times;</button>';
    } else {
      item.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:24px">' +
        (att.kind === 'video' ? '🎬' : att.kind === 'audio' ? '🎵' : '📄') + '</div>' +
        '<button class="msg-attachment-preview-remove" data-idx="' + i + '">&times;</button>';
    }
    container.appendChild(item);
  });
  container.querySelectorAll('.msg-attachment-preview-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pendingAttachments.splice(parseInt(btn.dataset.idx), 1);
      renderAttachmentPreview();
    });
  });
}

document.getElementById('message-input')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input?.value?.trim();
    const attachments = pendingAttachments.length > 0 ? pendingAttachments.slice() : undefined;
    if (!text && !attachments) return;
    input.value = '';
    pendingAttachments = [];
    renderAttachmentPreview();
    emitTypingStop();
    if (currentView === 'dm' && currentDM) {
      const tempId = 'temp-' + Date.now();
      appendMessage({ id: tempId, authorId: userId, content: text || '', timestamp: Date.now(), attachments: attachments || [] });
      scrollMessagesToBottom();
      try { await window.api.dmSend(currentDM.id, userId, text || '', attachments); } catch(e) {}
      lastDMPollCount = 0;
      await loadDMMessages();
    } else if (currentChannel) {
      const tempId = 'temp-' + Date.now();
      appendMessage({ id: tempId, authorId: userId, content: text || '', timestamp: Date.now(), attachments: attachments || [] });
      scrollMessagesToBottom();
      try { await window.api.messagesSend(currentChannel.id, currentServer?.id || null, userId, text || '', attachments); } catch(e) {}
      lastChannelMsgCount[currentChannel.id] = 0;
      await loadMessages();
    }
  }
});

// ── Typing Indicator ──
let typingTimeout = null;
let isCurrentlyTyping = false;

function emitTypingStart() {
  if (!currentChannel || currentView !== 'server') return;
  if (!isCurrentlyTyping) {
    isCurrentlyTyping = true;
    emitSocket('typing:start', { channelId: currentChannel.id });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(emitTypingStop, 3000);
}

function emitTypingStop() {
  if (!isCurrentlyTyping) return;
  isCurrentlyTyping = false;
  clearTimeout(typingTimeout);
  if (currentChannel && currentView === 'server') {
    emitSocket('typing:stop', { channelId: currentChannel.id });
  }
}

function emitSocket(evt, data) {
  if (window.KryoCalls && window.KryoCalls._socket) {
    window.KryoCalls._socket.emit(evt, data);
  }
}

document.getElementById('message-input')?.addEventListener('input', function () {
  if (this.value.length > 0) emitTypingStart();
  else emitTypingStop();
});

const typingIndicatorUsers = {};

window.handleTypingUpdate = function (data) {
  if (!data || !data.channelId) return;
  if (data.typing) {
    typingIndicatorUsers[data.userId] = { username: data.username, channelId: data.channelId };
  } else {
    delete typingIndicatorUsers[data.userId];
  }
  renderTypingIndicator();
};

window.handleTypingState = function (data) {
  if (!data || !data.channelId) return;
  Object.keys(typingIndicatorUsers).forEach(function (k) {
    if (typingIndicatorUsers[k]?.channelId === data.channelId) delete typingIndicatorUsers[k];
  });
  (data.typers || []).forEach(function (t) {
    typingIndicatorUsers[t.userId] = { username: t.username, channelId: data.channelId };
  });
  renderTypingIndicator();
};

function renderTypingIndicator() {
  var el = document.getElementById('typing-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.style.cssText = 'font-size:12px;color:var(--text-muted);padding:2px 16px 4px;min-height:18px;display:flex;align-items:center;gap:6px';
    var wrapper = document.getElementById('chat-input-wrapper');
    if (wrapper) wrapper.parentNode.insertBefore(el, wrapper);
  }
  var channelTypers = Object.values(typingIndicatorUsers).filter(function (t) {
    return currentChannel && t.channelId === currentChannel.id && t.userId !== userId;
  });
  if (channelTypers.length === 0) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  if (channelTypers.length === 1) {
    el.innerHTML = '<span style="font-weight:600">' + escHtml(channelTypers[0].username) + '</span> ' + t('isTyping') + ' <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
  } else if (channelTypers.length === 2) {
    el.innerHTML = '<span style="font-weight:600">' + escHtml(channelTypers[0].username) + '</span> und <span style="font-weight:600">' + escHtml(channelTypers[1].username) + '</span> ' + t('areTyping') + ' <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
  } else {
    el.innerHTML = '<span style="font-weight:600">' + escHtml(channelTypers[0].username) + '</span> und ' + (channelTypers.length - 1) + ' weitere ' + t('areTyping') + ' <span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
  }
}

// ── Context Menu ──
function showContextMenu(e, msgEl) {
  e.preventDefault();
  e.stopPropagation();
  const menu = ensureContextMenu();
  const msgId = msgEl.dataset.msgId;
  const authorId = msgEl.dataset.authorId;
  const isOwn = authorId === userId;
  const isAdmin = currentUser?.is_admin;
  const contentEl = document.getElementById('msg-content-' + msgId);
  const content = contentEl?.textContent || '';
  var html = '<div class="context-menu-item" data-action="copy">' + t('copy') + '</div>' +
    '<div class="context-menu-item" data-action="react">' + t('addReaction') + '</div>';
  if (isOwn) html += '<div class="context-menu-item" data-action="edit">' + t('edit') + '</div>';
  if (isOwn || isAdmin) html += '<div class="context-menu-item danger" data-action="delete">' + t('delete') + '</div>';
  menu.innerHTML = html;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
  });
  menu.querySelectorAll('.context-menu-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      menu.classList.add('hidden');
      if (action === 'copy') {
        await navigator.clipboard.writeText(content).catch(() => {});
      } else if (action === 'react') {
        showEmojiPicker(msgId, item);
      } else if (action === 'edit') {
        startEditMessage(msgId, content);
      } else if (action === 'delete') {
        if (confirm(t('confirmDeleteMessage'))) {
          await window.api.messagesDelete(msgId);
          if (currentView === 'dm' && currentDM) await loadDMMessages();
          else if (currentChannel) await loadMessages();
        }
      }
    });
  });
}

function startEditMessage(msgId, currentContent) {
  const contentEl = document.getElementById('msg-content-' + msgId);
  if (!contentEl) return;
  const editedLabel = contentEl.querySelector('.msg-edited');
  const editedHtml = editedLabel ? editedLabel.outerHTML : '';
  contentEl.innerHTML = '<div class="msg-edit-wrap"><input class="msg-edit-input" type="text" value="' + escHtml(currentContent) + '" /><div class="msg-edit-hint">' + t('enterToSave') + ' · Esc zum Abbrechen</div></div>';
  const input = contentEl.querySelector('.msg-edit-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const newContent = input.value.trim();
    if (!newContent || newContent === currentContent) { contentEl.textContent = currentContent; if (editedHtml) contentEl.innerHTML += editedHtml; return; }
    try { if (window.api.messagesEdit) await window.api.messagesEdit(msgId, newContent); } catch {}
    contentEl.textContent = newContent;
    if (editedHtml) contentEl.innerHTML += editedHtml;
  };
  const cancel = () => { saved = true; contentEl.textContent = currentContent; if (editedHtml) contentEl.innerHTML += editedHtml; };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save(); }
    if (ev.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', save);
}

// ── Home ──
document.getElementById('home-btn')?.addEventListener('click', () => {
  closeMobileMenu();
  currentView = 'home';
  currentServer = null;
  currentChannel = null;
  currentDM = null;
  document.getElementById('home-btn')?.classList.add('active');
  document.getElementById('dm-btn')?.classList.remove('active');
  document.querySelectorAll('.server-icon.server-item').forEach((el) => el.classList.remove('active'));
  const sh = document.getElementById('server-header');
  if (sh) sh.textContent = currentUser?.username || t('home');
  document.getElementById('server-channels')?.classList.add('hidden');
  document.getElementById('dm-list')?.classList.add('hidden');
  document.getElementById('chat-header')?.classList.add('hidden');
  document.getElementById('chat-input-wrapper')?.classList.add('hidden');
  document.getElementById('server-settings-btn')?.classList.add('hidden');
  document.getElementById('toggle-members')?.classList.add('hidden');
  const cc = document.getElementById('current-channel');
  if (cc) cc.textContent = currentUser?.username || t('home');
  hideMembersSidebar();
  const msgs = document.getElementById('messages');
  if (msgs) msgs.innerHTML = '<div style="padding:40px;color:var(--text-muted);text-align:center"><h2>' + t('welcome') + ' ' + escHtml(currentUser?.username || '') + '!</h2><p>' + t('homeDesc') + '</p></div>';
});

// ── DMs ──
document.getElementById('dm-btn')?.addEventListener('click', async () => {
  closeMobileMenu();
  currentView = 'dms';
  currentServer = null;
  currentChannel = null;
  currentDM = null;
  document.getElementById('home-btn')?.classList.remove('active');
  document.getElementById('dm-btn')?.classList.add('active');
  document.querySelectorAll('.server-icon.server-item').forEach((el) => el.classList.remove('active'));
  const sh = document.getElementById('server-header');
  if (sh) sh.textContent = t('directMessages');
  document.getElementById('server-channels')?.classList.add('hidden');
  document.getElementById('dm-list')?.classList.remove('hidden');
  document.getElementById('chat-header')?.classList.add('hidden');
  document.getElementById('chat-input-wrapper')?.classList.add('hidden');
  document.getElementById('server-settings-btn')?.classList.add('hidden');
  document.getElementById('toggle-members')?.classList.add('hidden');
  const cc = document.getElementById('current-channel');
  if (cc) cc.textContent = t('directMessages');
  hideMembersSidebar();
  await loadDMList();
  const msgs = document.getElementById('messages');
  if (msgs) msgs.innerHTML = '<div style="padding:40px;color:var(--text-muted);text-align:center"><p>' + t('dmDesc') + '</p></div>';
});

async function loadDMList() {
  const dms = (await window.api.dmGetAll(userId)) || [];
  const items = document.getElementById('dm-items');
  if (!items) return;
  items.innerHTML = '';
  for (const dm of dms) {
    const otherId = dm.participants?.find((p) => p !== userId);
    let otherName = otherId ? getAuthorNameSync(otherId) : t('unknown');
    let otherAvatar = null;
    let otherStatus = 'offline';
    if (otherId && !authorNameCache[otherId]) {
      for (const s of allServers) {
        if (!s.members) continue;
        const m = s.members.find((mem) => (mem.id || mem.userId) === otherId);
        if (m?.username) { otherName = m.username; authorNameCache[otherId] = otherName; if (m.avatarPath) { otherAvatar = m.avatarPath; authorAvatarCache[otherId] = m.avatarPath; } if (m.status) { otherStatus = m.status; authorStatusCache[otherId] = m.status; } if (m.bannerPath) authorBannerCache[otherId] = m.bannerPath; break; }
      }
    }
    if (otherId && otherName === otherId.substring(0, 8)) {
      try {
        const result = await window.api.getUserById(otherId);
        if (result?.ok && result.user?.username) { otherName = result.user.username; authorNameCache[otherId] = otherName; cacheUserData(result.user); if (result.user.avatarPath) otherAvatar = result.user.avatarPath; if (result.user.status) otherStatus = result.user.status; }
      } catch {}
    }

    var msgs = dm.messages || [];
    var lastMsg = msgs[msgs.length - 1];
    var lastSeen = lastSeenTimestamps[dm.id] || 0;
    if (lastMsg && lastMsg.authorId !== userId && lastMsg.timestamp > lastSeen) {
      if (!unreadDMs[dm.id]) {
        unreadDMs[dm.id] = true;
        if (lastSeen > 0) {
          var msgText = lastMsg.content || t('newMessage');
          var avSrc = getAuthorAvatarSync(otherId) || (otherAvatar ? toFileUrl(otherAvatar) : defaultAvatar(otherName[0] || '?'));
          playDMNotification();
          showToast(otherName, msgText, avSrc);
        }
      }
    }

    const el = document.createElement('div');
    el.className = 'dm-item' + (currentDM?.id === dm.id ? ' active' : '');
    const avatarSrc = getAuthorAvatarSync(otherId) || (otherAvatar ? toFileUrl(otherAvatar) : defaultAvatar(otherName[0] || '?'));
    const statusColor = otherStatus === 'online' ? '#23a55a' : otherStatus === 'idle' ? '#f0b232' : otherStatus === 'dnd' ? '#f23f43' : '#80848e';

    var isUnread = unreadDMs[dm.id] === true;
    var unreadBadge = isUnread ? '<div style="width:8px;height:8px;border-radius:50%;background:#f23f43;flex-shrink:0;margin-left:auto"></div>' : '';
    var nameWeight = isUnread ? 'font-weight:700;color:var(--text-main)' : '';

    el.innerHTML =
      '<div class="dm-item-avatar-wrap" style="cursor:pointer">' +
        '<img class="dm-item-avatar" src="' + avatarSrc + '" />' +
        '<div class="dm-item-status" style="background:' + statusColor + '"></div>' +
      '</div>' +
      '<div class="dm-item-info">' +
        '<div class="dm-item-name" style="cursor:pointer;' + nameWeight + '">' + escHtml(otherName) + '</div>' +
      '</div>' +
      unreadBadge;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.dm-item-avatar-wrap') || ev.target.closest('.dm-item-name')) {
        if (otherId) showProfilePopup(otherId);
        return;
      }
      openDM(dm);
    });
    items.appendChild(el);
  }
  updateDMBadge();
}

// ── Friends ──
let currentFriendsTab = 'list';

document.getElementById('tab-dms')?.addEventListener('click', function() {
  currentFriendsTab = 'dms';
  document.getElementById('tab-dms')?.classList.add('active');
  document.getElementById('tab-friends')?.classList.remove('active');
  document.getElementById('dm-section')?.classList.remove('hidden');
  document.getElementById('friends-section')?.classList.add('hidden');
  loadDMList();
});

document.getElementById('tab-friends')?.addEventListener('click', function() {
  currentFriendsTab = 'list';
  document.getElementById('tab-friends')?.classList.add('active');
  document.getElementById('tab-dms')?.classList.remove('active');
  document.getElementById('friends-section')?.classList.remove('hidden');
  document.getElementById('dm-section')?.classList.add('hidden');
  loadFriendsList();
});

document.getElementById('friends-add-btn')?.addEventListener('click', async function() {
  const input = document.getElementById('friends-add-input');
  const username = input?.value?.trim();
  if (!username) return;
  const result = await window.api.getUserPublic(username);
  if (!result?.ok || !result.user) {
    alert(t('userNotFound'));
    return;
  }
  if (result.user.id === userId) {
    alert(t('cannotFriendSelf'));
    return;
  }
  const sendResult = await window.api.friendsSendRequest(userId, result.user.id);
  if (sendResult?.ok) {
    input.value = '';
    alert(t('friendRequestSent'));
  } else {
    alert(sendResult?.error || t('friendRequestSendError'));
  }
});

async function loadFriendsList() {
  const friends = (await window.api.friendsGetList(userId)) || [];
  const requests = (await window.api.friendsGetRequests(userId)) || [];
  const requestsList = document.getElementById('friends-requests-list');
  const friendsListEl = document.getElementById('friends-list');

  if (requestsList) {
    requestsList.innerHTML = '';
    const pending = requests.filter(r => r.status === 'pending' && r.toId === userId);
    if (pending.length > 0) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = t('requests') + ' (' + pending.length + ')';
      requestsList.appendChild(label);
      for (const req of pending) {
        const el = document.createElement('div');
        el.className = 'friend-request-item';
        const fromName = req.fromUser?.username || t('unknown');
        const fromAvatar = req.fromUser?.avatarPath ? toFileUrl(req.fromUser.avatarPath) : defaultAvatar(fromName[0]);
        el.innerHTML = '<img class="friend-avatar" src="' + fromAvatar + '" alt="" style="cursor:pointer" />' +
          '<div class="friend-request-info"><div class="friend-name" style="cursor:pointer">' + escHtml(fromName) + '</div>' +
          '<div class="friend-request-label">' + t('wantsToBeFriend') + '</div></div>' +
          '<div class="friend-actions">' +
            '<button class="friend-action-btn" data-req="' + req.id + '" data-action="accept" title="' + t('invite') + '">✓</button>' +
            '<button class="friend-action-btn danger" data-req="' + req.id + '" data-action="decline" title="' + t('delete') + '">✕</button>' +
          '</div>';
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('.friend-action-btn')) return;
          if ((ev.target.closest('.friend-avatar') || ev.target.closest('.friend-name')) && req.fromUser?.id) {
            showProfilePopup(req.fromUser.id);
          }
        });
        requestsList.appendChild(el);
      }
      requestsList.querySelectorAll('.friend-action-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          const reqId = btn.dataset.req;
          const action = btn.dataset.action;
          if (action === 'accept') {
            await window.api.friendsAcceptRequest(reqId);
          } else {
            await window.api.friendsDeclineRequest(reqId);
          }
          loadFriendsList();
        });
      });
    }
  }

  if (friendsListEl) {
    friendsListEl.innerHTML = '';
    if (friends.length > 0) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = t('friends') + ' (' + friends.length + ')';
      friendsListEl.appendChild(label);
      for (const f of friends) {
        const el = document.createElement('div');
        el.className = 'friend-item';
        const fAvatar = f.avatarPath ? toFileUrl(f.avatarPath) : defaultAvatar((f.username || '?')[0]);
        const statusColors = { online: '#3ba55d', idle: '#f0b232', dnd: '#ed4245', invisible: '#80848e' };
        const statusColor = statusColors[f.status || 'online'] || statusColors.online;
        el.innerHTML = '<img class="friend-avatar" src="' + fAvatar + '" alt="" style="cursor:pointer" />' +
          '<div class="friend-info"><div class="friend-name" style="cursor:pointer">' + escHtml(f.username) + '</div>' +
          '<div class="friend-status" style="color:' + statusColor + '">' + (f.status || t('online')) + '</div></div>' +
          '<div class="friend-actions">' +
            '<button class="friend-action-btn" data-friend="' + f.id + '" data-action="dm" title="' + t('sendMessage') + '">💬</button>' +
            '<button class="friend-action-btn danger" data-friend="' + f.id + '" data-action="remove" title="' + t('removeFriendBtn') + '">✕</button>' +
          '</div>';
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('.friend-action-btn')) return;
          if (ev.target.closest('.friend-avatar') || ev.target.closest('.friend-name')) {
            showProfilePopup(f.id);
          }
        });
        friendsListEl.appendChild(el);
      }
      friendsListEl.querySelectorAll('.friend-action-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          const friendId = btn.dataset.friend;
          const action = btn.dataset.action;
          if (action === 'dm') {
            const dm = await window.api.dmGetOrCreate(userId, friendId);
            if (dm?.id) {
              document.getElementById('tab-dms')?.click();
              setTimeout(function() { openDM(dm); }, 100);
            }
          } else if (action === 'remove') {
            if (confirm(t('removeFriend'))) {
              await window.api.friendsRemove(userId, friendId);
              loadFriendsList();
            }
          }
        });
      });
    } else if (requests.filter(r => r.toId === userId).length === 0) {
      friendsListEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">' + t('noFriendsYet') + '</div>';
    }
  }
}

async function openDM(dm) {
  closeMobileMenu();
  currentDM = dm;
  currentView = 'dm';
  currentChannel = null;
  currentServer = null;
  document.getElementById('dm-list')?.querySelectorAll('.dm-item').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.server-icon.server-item').forEach((el) => el.classList.remove('active'));
  const sh = document.getElementById('server-header');
  if (sh) sh.textContent = t('directMessage');
  document.getElementById('server-channels')?.classList.add('hidden');
  document.getElementById('dm-list')?.classList.remove('hidden');
  document.getElementById('chat-header')?.classList.remove('hidden');
  document.getElementById('chat-input-wrapper')?.classList.remove('hidden');
  document.getElementById('server-settings-btn')?.classList.add('hidden');
  document.getElementById('toggle-members')?.classList.add('hidden');
  document.getElementById('dm-call-actions').style.display = 'flex';
  hideMembersSidebar();
  const otherId = dm.participants?.find((p) => p !== userId);
  let otherName = otherId ? await getAuthorName(otherId) : '?';
  const cc = document.getElementById('current-channel');
  if (cc) {
    cc.textContent = '';
    cc.innerHTML = '<span style="cursor:pointer" data-author-id="' + otherId + '">' + t('dmPrefix') + ' \u2014 ' + escHtml(otherName) + '</span>';
    cc.style.cursor = 'pointer';
    cc.onclick = function(ev) {
      const span = ev.target.closest('[data-author-id]');
      if (span) showProfilePopup(span.dataset.authorId);
    };
  }
  const msgInput = document.getElementById('message-input');
  if (msgInput) msgInput.placeholder = t('messageTo') + ' ' + otherName;
  unreadDMs[dm.id] = false;
  lastSeenTimestamps[dm.id] = Date.now();
  updateDMBadge();
  loadDMList();
  await loadDMMessages();
  setupDMCallButtons(otherId, otherName);
}

function setupDMCallButtons(otherId, otherName) {
  document.getElementById('dm-call-actions').style.display = 'flex';
  var voiceBtn = document.getElementById('dm-call-voice');
  if (voiceBtn) voiceBtn.onclick = function() { window.startCall(otherId, otherName, 'voice'); };
}

function hideDMCallButtons() {
  document.getElementById('dm-call-actions').style.display = 'none';
}

async function loadDMMessages() {
  if (!currentDM) return;
  const msgs = (await window.api.dmGetMessages(currentDM.id)) || [];
  lastDMPollCount = msgs.length;
  await renderDMMessages(msgs);
}

async function renderDMMessages(msgs) {
  const list = document.getElementById('messages');
  if (!list) return;
  list.innerHTML = '';
  let lastAuthor = null;
  let lastTime = 0;
  let lastDate = '';

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const msgDate = new Date(m.timestamp);
    const dateStr = msgDate.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = msgDate.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
    const fullTimeStr = msgDate.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + timeStr;

    if (dateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let label = dateStr;
      if (dateStr === today.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })) label = t('today');
      else if (dateStr === yesterday.toLocaleDateString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })) label = t('yesterday');
      sep.innerHTML = '<span>' + label + '</span>';
      list.appendChild(sep);
      lastDate = dateStr;
      lastAuthor = null;
      lastTime = 0;
    }

    const isGrouped = lastAuthor === m.authorId && (m.timestamp - lastTime) < 420000;
    lastAuthor = m.authorId;
    lastTime = m.timestamp;

    const authorName = m.authorId === userId ? t('you') : getAuthorNameSync(m.authorId);
    const avatarSrc = m.authorId === userId
      ? (currentUser?.avatarPath ? toFileUrl(currentUser.avatarPath) : defaultAvatar(currentUser?.username?.[0]))
      : (getAuthorAvatarSync(m.authorId) || defaultAvatar(authorName[0]));

    const div = document.createElement('div');
    div.className = 'msg' + (isGrouped ? ' grouped' : '');
    div.dataset.msgId = m.id;
    div.dataset.authorId = m.authorId;

    let attachmentsHtml = '';
    if (m.attachments?.length > 0) {
      attachmentsHtml = '<div class="msg-attachments">' + m.attachments.map(function(att) {
        return renderAttachmentHTML(att);
      }).join('') + '</div>';
    }

    if (isGrouped) {
      div.innerHTML =
        '<div class="msg-hover-time">' + timeStr + '</div>' +
        '<div class="msg-body">' +
          '<div class="msg-content" id="msg-content-' + m.id + '">' + escHtml(m.content) + '</div>' +
          attachmentsHtml +
        '</div>';
    } else {
      div.innerHTML =
        '<img class="msg-avatar" src="' + avatarSrc + '" alt="" data-author-id="' + m.authorId + '" />' +
        '<div class="msg-body">' +
          '<div class="msg-header">' +
            '<span class="author" data-author-id="' + m.authorId + '">' + escHtml(authorName) + '</span>' +
            '<span class="msg-timestamp" title="' + fullTimeStr + '">' + timeStr + '</span>' +
          '</div>' +
          '<div class="msg-content" id="msg-content-' + m.id + '">' + escHtml(m.content) + '</div>' +
          attachmentsHtml +
        '</div>';
    }
    list.appendChild(div);
  }
  list.scrollTop = list.scrollHeight;
  for (const m of msgs) {
    if (m.authorId !== userId && !authorNameCache[m.authorId]) {
      const name = await getAuthorName(m.authorId);
      const authorEl = list.querySelector('[data-msg-id="' + m.id + '"] .author');
      if (authorEl) authorEl.textContent = name;
      const avatarEl = list.querySelector('[data-msg-id="' + m.id + '"] .msg-avatar');
      if (avatarEl && authorAvatarCache[m.authorId]) avatarEl.src = toFileUrl(authorAvatarCache[m.authorId]);
    }
  }
}

// ── DM Neu ──
document.getElementById('dm-new')?.addEventListener('click', () => {
  document.getElementById('dm-new-overlay')?.classList.remove('hidden');
});
document.getElementById('close-dm-new')?.addEventListener('click', () => {
  document.getElementById('dm-new-overlay')?.classList.add('hidden');
});
document.getElementById('dm-new-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('dm-target-username');
  const username = input?.value?.trim();
  const errorEl = document.getElementById('dm-new-error');
  if (errorEl) errorEl.textContent = '';
  if (!username) { if (errorEl) errorEl.textContent = t('enterUsername'); return; }
  const lookup = await window.api.getUserPublic(username);
  if (!lookup?.ok) { if (errorEl) errorEl.textContent = t('userNotFound'); return; }
  if (lookup.user?.id === userId) { if (errorEl) errorEl.textContent = t('cannotDMSelf'); return; }
  const dm = await window.api.dmGetOrCreate(userId, lookup.user.id);
  document.getElementById('dm-new-overlay')?.classList.add('hidden');
  if (input) input.value = '';
  openDM(dm);
});

// ── Server erstellen / beitreten ──
document.getElementById('add-server')?.addEventListener('click', () => {
  document.getElementById('create-server-overlay')?.classList.remove('hidden');
  document.getElementById('create-server-form')?.classList.add('hidden');
  document.getElementById('join-server-form')?.classList.add('hidden');
});
document.getElementById('close-create-server')?.addEventListener('click', () => {
  document.getElementById('create-server-overlay')?.classList.add('hidden');
});
document.getElementById('show-create-server')?.addEventListener('click', () => {
  document.getElementById('create-server-form')?.classList.remove('hidden');
  document.getElementById('join-server-form')?.classList.add('hidden');
});
document.getElementById('show-join-server')?.addEventListener('click', () => {
  document.getElementById('join-server-form')?.classList.remove('hidden');
  document.getElementById('create-server-form')?.classList.add('hidden');
});
document.getElementById('create-server-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('new-server-name');
  const name = input?.value?.trim();
  const errorEl = document.getElementById('create-server-error');
  if (errorEl) errorEl.textContent = '';
  if (!name) { if (errorEl) errorEl.textContent = t('enterName'); return; }
  const server = await window.api.serverCreate(name, userId);
  document.getElementById('create-server-overlay')?.classList.add('hidden');
  if (input) input.value = '';
  await loadServers();
  if (server) selectServer(server);
});
document.getElementById('join-server-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('join-server-code');
  const code = input?.value?.trim();
  const errorEl = document.getElementById('join-server-error');
  if (errorEl) errorEl.textContent = '';
  if (!code) { if (errorEl) errorEl.textContent = t('enterInviteCode'); return; }
  const res = await window.api.serverJoinByCode(code, currentUser.id);
  if (res?.ok) {
    document.getElementById('create-server-overlay')?.classList.add('hidden');
    if (input) input.value = '';
    await loadServers();
    if (res.server) selectServer(res.server);
  } else {
    if (errorEl) { errorEl.textContent = res?.error || t('invalidCode'); }
  }
});

// ── Server-Einstellungen ──
document.getElementById('server-settings-btn')?.addEventListener('click', () => {
  closeMobileMenu();
  if (!currentServer) return;
  openServerSettings();
});

function openServerSettings(section) {
  const overlay = document.getElementById('server-settings-overlay');
  const nav = document.getElementById('ss-nav');
  const body = document.getElementById('server-settings-body');
  if (!overlay || !nav || !body) return;
  ssIsOwner = currentServer.ownerId === userId;

  const navItems = [];
  navItems.push({ id: 'overview', label: '⚙️ ' + t('overview') });
  if (ssIsOwner) {
    navItems.push({ id: 'roles', label: '🎨 ' + t('roles') });
    navItems.push({ id: 'channels', label: '💬 ' + t('channels') });
  }
  navItems.push({ id: 'invites', label: '🔗 ' + t('invites') });
  navItems.push({ id: 'members', label: '👥 ' + t('members') });

  nav.innerHTML = navItems.map(function(item) {
    var active = (!section && item.id === 'overview') || section === item.id ? ' active' : '';
    return '<div class="ss-nav-item' + active + '" data-section="' + item.id + '">' + item.label + '</div>';
  }).join('');

  var renderSection = function(sec) {
    nav.querySelectorAll('.ss-nav-item').forEach(function(n) { n.classList.toggle('active', n.dataset.section === sec); });

    if (sec === 'overview') renderOverview(body);
    else if (sec === 'roles') renderRoles(body);
    else if (sec === 'channels') renderChannelsSettings(body);
    else if (sec === 'invites') renderInvites(body);
    else if (sec === 'members') renderMembersSettings(body);
  };

  nav.querySelectorAll('.ss-nav-item').forEach(function(item) {
    item.addEventListener('click', function() { renderSection(item.dataset.section); });
  });

  document.getElementById('close-server-settings')?.addEventListener('click', function() {
    overlay.classList.add('hidden');
  });

  overlay.classList.remove('hidden');
  renderSection(section || 'overview');
}

function renderOverview(el) {
  var iconPreview = currentServer.icon ? '<img src="' + toFileUrl(currentServer.icon) + '" alt="" />' : currentServer.name.substring(0, 2).toUpperCase();
  el.innerHTML = '<div class="ss-section-title">' + t('overview') + '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('serverImage') + '</div>' +
      '<div class="ss-icon-preview" id="ss-icon-preview" style="cursor:pointer">' + iconPreview + '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="ss-btn ss-btn-secondary" id="ss-change-icon">' + t('changeAvatar') + '</button>' +
        '<button class="ss-btn ss-btn-secondary" id="ss-remove-icon" style="color:#f23f43">' + t('reset') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('serverNameLabel') + '</div>' +
      '<input type="text" class="ss-input" id="ss-name" value="' + escHtml(currentServer.name) + '" />' +
      '<button class="ss-btn ss-btn-primary" id="ss-rename" style="margin-top:12px">' + t('saveChanges') + '</button>' +
    '</div>' +
    (currentServer.description !== undefined ? '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('descriptionLabel') + '</div>' +
      '<textarea class="ss-input" id="ss-description" rows="3" style="max-width:100%;resize:vertical">' + escHtml(currentServer.description || '') + '</textarea>' +
      '<button class="ss-btn ss-btn-primary" id="ss-save-desc" style="margin-top:12px">' + t('saveChanges') + '</button>' +
    '</div>' : '') +
    '<div class="ss-danger-zone">' +
      '<div class="ss-danger-zone-title">' + (ssIsOwner ? t('deleteServer') : t('leaveServer')) + '</div>' +
      '<div class="ss-danger-zone-desc">' + (ssIsOwner ? t('confirmDeleteServer') : t('confirmLeaveServer')) + '</div>' +
      '<button class="ss-btn-danger" id="ss-danger-btn">' + (ssIsOwner ? t('deleteServer') : t('leaveServer')) + '</button>' +
    '</div>';

  document.getElementById('ss-change-icon')?.addEventListener('click', async function() {
    var r = await window.api.pickImage('avatar');
    if (r?.ok) {
      await window.api.serverUpdate(currentServer.id, { icon: r.path });
      currentServer.icon = r.path;
      var srv = allServers.find(function(s) { return s.id === currentServer.id; });
      if (srv) srv.icon = r.path;
      var preview = document.getElementById('ss-icon-preview');
      if (preview) preview.innerHTML = '<img src="' + toFileUrl(r.path) + '" alt="" />';
      renderServerRail();
    }
  });
  document.getElementById('ss-remove-icon')?.addEventListener('click', async function() {
    await window.api.serverUpdate(currentServer.id, { icon: null });
    currentServer.icon = null;
    var srv = allServers.find(function(s) { return s.id === currentServer.id; });
    if (srv) srv.icon = null;
    var preview = document.getElementById('ss-icon-preview');
    if (preview) preview.textContent = currentServer.name.substring(0, 2).toUpperCase();
    renderServerRail();
  });
  document.getElementById('ss-rename')?.addEventListener('click', async function() {
    var newName = document.getElementById('ss-name')?.value?.trim();
    if (!newName) return;
    await window.api.serverUpdate(currentServer.id, { name: newName });
    currentServer.name = newName;
    var h = document.getElementById('server-header');
    if (h) h.textContent = newName;
    renderServerRail();
    var navTitle = document.querySelector('.ss-nav-header');
    if (navTitle) navTitle.textContent = newName + ' — ' + t('serverSettings');
  });
  var descBtn = document.getElementById('ss-save-desc');
  if (descBtn) descBtn.addEventListener('click', async function() {
    var desc = document.getElementById('ss-description')?.value || '';
    await window.api.serverUpdate(currentServer.id, { description: desc });
    currentServer.description = desc;
  });
  document.getElementById('ss-danger-btn')?.addEventListener('click', async function() {
    if (ssIsOwner) {
      if (!confirm(t('confirmDeleteServer'))) return;
      await window.api.serverDelete(currentServer.id, userId);
      currentServer = null;
      document.getElementById('server-settings-overlay')?.classList.add('hidden');
      await loadServers();
      document.getElementById('home-btn')?.click();
    } else {
      if (!confirm(t('confirmLeaveServer'))) return;
      await window.api.serverLeave(currentServer.id, userId);
      currentServer = null;
      document.getElementById('server-settings-overlay')?.classList.add('hidden');
      await loadServers();
      document.getElementById('home-btn')?.click();
    }
  });
}

function renderRoles(el) {
  var roles = currentServer.roles || [];
  el.innerHTML = '<div class="ss-section-title">' + t('roles') + '</div>' +
    '<div class="ss-info-box">' + t('roleDesc') + '</div>' +
    '<div id="ss-roles-list">' +
    roles.map(function(r) {
      return '<div class="ss-role-row" data-role-id="' + r.id + '">' +
        '<div style="width:14px;height:14px;border-radius:50%;background:' + r.color + ';flex-shrink:0"></div>' +
        '<span style="font-size:14px;color:var(--text-main);font-weight:500">' + escHtml(r.name) + '</span>' +
        '<span style="font-size:12px;color:var(--text-muted);margin-left:4px">' + (r.memberIds?.length || 0) + '</span>' +
        '<div style="flex:1"></div>' +
        '<button class="ss-btn ss-btn-secondary" style="font-size:12px;padding:4px 10px" data-edit-role="' + r.id + '">' + t('edit') + '</button>' +
        '<button class="ss-btn-danger" style="font-size:12px;padding:4px 10px;margin-left:6px" data-del-role="' + r.id + '">' + t('delete') + '</button>' +
      '</div>';
    }).join('') +
    '</div>' +
    '<div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08)">' +
      '<div style="font-size:14px;font-weight:600;color:var(--text-main);margin-bottom:12px">' + t('createRole') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<input type="text" class="ss-input" id="ss-new-role-name" placeholder="' + t('roleName') + '" style="flex:1;max-width:200px" />' +
        '<input type="color" id="ss-new-role-color" value="#949ba4" style="width:40px;height:36px;border:none;border-radius:4px;cursor:pointer" />' +
        '<button class="ss-btn ss-btn-primary" id="ss-add-role">' + t('addRole') + '</button>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('[data-del-role]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm(t('confirmDeleteRole'))) return;
      await window.api.serverDeleteRole(currentServer.id, btn.dataset.delRole);
      currentServer.roles = (currentServer.roles || []).filter(function(r) { return r.id !== btn.dataset.delRole; });
      renderRoles(el);
    });
  });

  el.querySelectorAll('[data-edit-role]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var role = (currentServer.roles || []).find(function(r) { return r.id === btn.dataset.editRole; });
      if (!role) return;
      showRoleEditor(el, role);
    });
  });

  document.getElementById('ss-add-role')?.addEventListener('click', async function() {
    var name = document.getElementById('ss-new-role-name')?.value?.trim();
    var color = document.getElementById('ss-new-role-color')?.value || '#949ba4';
    if (!name) return;
    var role = await window.api.serverAddRole(currentServer.id, name, color);
    if (role) {
      if (!currentServer.roles) currentServer.roles = [];
      currentServer.roles.push(role);
      renderRoles(el);
    }
  });
}

function showRoleEditor(el, role) {
  var members = currentServer.members || [];
  el.innerHTML = '<div class="ss-section-title" style="display:flex;align-items:center;gap:8px">' +
    '<span style="cursor:pointer;color:var(--text-muted)" id="ss-role-back">←</span> ' + t('editRole') + '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('roleNameLabel') + '</div>' +
      '<input type="text" class="ss-input" id="ss-edit-role-name" value="' + escHtml(role.name) + '" />' +
    '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('color') + '</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<input type="color" id="ss-edit-role-color" value="' + role.color + '" style="width:48px;height:36px;border:none;border-radius:4px;cursor:pointer" />' +
        '<span style="color:' + role.color + ';font-weight:600">' + escHtml(role.name) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('membersLabel') + ' (' + members.length + ')</div>' +
      '<div style="max-height:300px;overflow-y:auto">' +
      members.map(function(m) {
        var mid = m.id || m.userId;
        var name = m.username || getAuthorNameSync(mid);
        var inRole = (role.memberIds || []).indexOf(mid) !== -1;
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">' +
          '<input type="checkbox" data-member-check="' + mid + '"' + (inRole ? ' checked' : '') + ' />' +
          '<span style="font-size:14px;color:var(--text-main)">' + escHtml(name) + '</span>' +
        '</label>';
      }).join('') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button class="ss-btn ss-btn-primary" id="ss-save-role">' + t('saveChanges') + '</button>' +
      '<button class="ss-btn ss-btn-danger" id="ss-delete-role">' + t('deleteRole') + '</button>' +
    '</div>';

  document.getElementById('ss-role-back')?.addEventListener('click', function() { renderRoles(el); });
  document.getElementById('ss-edit-role-color')?.addEventListener('input', function(e) {
    var preview = el.querySelector('[style*="font-weight:600"]');
    if (preview) preview.style.color = e.target.value;
  });
  document.getElementById('ss-save-role')?.addEventListener('click', async function() {
    var newName = document.getElementById('ss-edit-role-name')?.value?.trim();
    var newColor = document.getElementById('ss-edit-role-color')?.value || role.color;
    if (newName) await window.api.serverUpdateRole(currentServer.id, role.id, { name: newName, color: newColor });
    role.name = newName || role.name;
    role.color = newColor;
    var memberChecks = el.querySelectorAll('[data-member-check]');
    for (var i = 0; i < memberChecks.length; i++) {
      var cb = memberChecks[i];
      var mid = cb.dataset.memberCheck;
      var inRole = (role.memberIds || []).indexOf(mid) !== -1;
      if (cb.checked && !inRole) {
        role.memberIds = role.memberIds || [];
        role.memberIds.push(mid);
        await window.api.serverAssignRole(currentServer.id, role.id, mid);
      } else if (!cb.checked && inRole) {
        role.memberIds = role.memberIds.filter(function(id) { return id !== mid; });
        await window.api.serverRemoveRole(currentServer.id, role.id, mid);
      }
    }
    renderRoles(el);
  });
  document.getElementById('ss-delete-role')?.addEventListener('click', async function() {
    if (!confirm(t('confirmDeleteRole'))) return;
    await window.api.serverDeleteRole(currentServer.id, role.id);
    currentServer.roles = (currentServer.roles || []).filter(function(r) { return r.id !== role.id; });
    renderRoles(el);
  });
}

function renderChannelsSettings(el) {
  var channels = currentServer.channels || [];
  var categories = currentServer.categories || [];
  el.innerHTML = '<div class="ss-section-title">' + t('channels') + '</div>' +
    '<div class="ss-info-box">' + t('channelSettingsDesc') + '</div>' +
    categories.map(function(cat) {
      var catChannels = channels.filter(function(c) { return c.categoryId === cat.id || (!c.categoryId && cat === categories[0]); });
      return '<div style="margin-bottom:16px">' +
        '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">' + escHtml(cat.name) + '</div>' +
        catChannels.map(function(ch) {
          var icon = ch.type === 'voice' ? '🔊' : '#';
          return '<div class="ss-channel-row">' +
            '<span style="font-size:14px;color:var(--text-muted)">' + icon + '</span>' +
            '<span style="font-size:14px;color:var(--text-main)">' + escHtml(ch.name) + '</span>' +
            '<div style="flex:1"></div>' +
            '<button class="ss-btn-danger" style="font-size:12px;padding:4px 10px" data-del-ch="' + ch.id + '">' + t('delete') + '</button>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('') +
    '<div style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.08)">' +
      '<div style="font-size:14px;font-weight:600;color:var(--text-main);margin-bottom:12px">' + t('createChannel') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<select id="ss-new-ch-type" class="ss-input" style="max-width:120px">' +
          '<option value="text">Text</option>' +
          '<option value="voice">Voice</option>' +
        '</select>' +
        '<input type="text" class="ss-input" id="ss-new-ch-name" placeholder="' + t('channelNamePlaceholder') + '" style="flex:1;max-width:250px" />' +
        '<button class="ss-btn ss-btn-primary" id="ss-add-channel">' + t('addChannel') + '</button>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('[data-del-ch]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm(t('confirmDeleteChannel'))) return;
      await window.api.serverDeleteChannel(currentServer.id, btn.dataset.delCh);
      currentServer.channels = currentServer.channels.filter(function(c) { return c.id !== btn.dataset.delCh; });
      renderChannels();
      renderChannelsSettings(el);
    });
  });

  document.getElementById('ss-add-channel')?.addEventListener('click', async function() {
    var name = document.getElementById('ss-new-ch-name')?.value?.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    var type = document.getElementById('ss-new-ch-type')?.value || 'text';
    if (!name) return;
    var ch = await window.api.serverAddChannel(currentServer.id, name, type);
    if (ch) { currentServer.channels.push(ch); renderChannels(); renderChannelsSettings(el); }
  });
}

function renderInvites(el) {
  var inviteCode = currentServer.inviteCode || '—';
  el.innerHTML = '<div class="ss-section-title">' + t('invites') + '</div>' +
    '<div class="ss-card">' +
      '<div class="ss-field-label">' + t('inviteLink') + '</div>' +
      '<div class="ss-field-desc">' + t('inviteLinkDesc') + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:12px">' +
        '<input type="text" id="ss-invite-code-display" readonly value="' + escHtml(inviteCode) + '" style="flex:1;padding:10px;border-radius:4px;border:none;background:var(--bg-input);color:var(--text-main);font-size:18px;letter-spacing:3px;font-family:monospace;text-transform:uppercase;text-align:center" />' +
        '<button class="ss-btn ss-btn-secondary" id="ss-copy-invite" style="padding:10px 16px">' + t('copyBtn') + '</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="ss-btn ss-btn-primary" id="ss-regen-invite">' + t('regenerateCode') + '</button>' +
      '</div>' +
    '</div>';

  document.getElementById('ss-copy-invite')?.addEventListener('click', function() {
    navigator.clipboard?.writeText(inviteCode);
    var btn = document.getElementById('ss-copy-invite');
    if (btn) { btn.textContent = t('copiedBtn'); setTimeout(function() { btn.textContent = t('copyBtn'); }, 1500); }
  });
  document.getElementById('ss-regen-invite')?.addEventListener('click', async function() {
    var res = await window.api.serverRegenerateInviteCode(currentServer.id);
    if (res?.ok) {
      currentServer.inviteCode = res.code;
      inviteCode = res.code;
      var codeInput = document.getElementById('ss-invite-code-display');
      if (codeInput) codeInput.value = res.code;
    }
  });
}

function renderMembersSettings(el) {
  var members = currentServer.members || [];
  var roles = currentServer.roles || [];
  el.innerHTML = '<div class="ss-section-title">' + t('members') + ' (' + members.length + ')</div>' +
    '<div style="margin-bottom:16px">' +
      '<input type="text" class="ss-input" id="ss-member-search" placeholder="' + t('searchMembers') + '" style="max-width:100%;margin-bottom:12px" />' +
    '</div>' +
    '<div id="ss-members-list">' +
    members.map(function(m) {
      var mid = m.id || m.userId;
      var name = m.username || getAuthorNameSync(mid);
      var avatar = m.avatarPath ? toFileUrl(m.avatarPath) : defaultAvatar(name[0]);
      var status = m.status || 'offline';
      var statusColors = { online: '#3ba55d', idle: '#f0b232', dnd: '#ed4245', offline: '#80848e' };
      var dotColor = statusColors[status] || statusColors.offline;
      var roleHtml = '';
      if (ssIsOwner && roles.length > 0) {
        var opts = '<option value="">' + t('noRole') + '</option>' +
          roles.map(function(r) {
            var sel = (r.memberIds || []).indexOf(mid) !== -1 ? ' selected' : '';
            return '<option value="' + r.id + '"' + sel + '>' + escHtml(r.name) + '</option>';
          }).join('');
        roleHtml = '<select class="ss-member-role-select" data-member-id="' + mid + '">' + opts + '</select>';
      } else {
        for (var ri = 0; ri < roles.length; ri++) {
          if ((roles[ri].memberIds || []).indexOf(mid) !== -1) {
            roleHtml = '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:' + roles[ri].color + ';color:#fff">' + escHtml(roles[ri].name) + '</span>';
            break;
          }
        }
      }
      return '<div class="ss-member-row" data-member-name="' + escHtml(name).toLowerCase() + '" data-member-id="' + mid + '" style="cursor:pointer">' +
        '<div style="position:relative;flex-shrink:0">' +
          '<img src="' + avatar + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover" alt="" />' +
          '<div style="position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:' + dotColor + ';border:2px solid var(--bg-list)"></div>' +
        '</div>' +
        '<span style="font-size:14px;color:var(--text-main);flex:1">' + escHtml(name) + '</span>' +
        (m.id === currentServer.ownerId ? '<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:#f0b232;color:#000;font-weight:700">OWNER</span>' : '') +
        roleHtml +
      '</div>';
    }).join('') +
    '</div>';

  document.getElementById('ss-member-search')?.addEventListener('input', function(e) {
    var q = e.target.value.toLowerCase();
    el.querySelectorAll('.ss-member-row').forEach(function(row) {
      var name = row.dataset.memberName || '';
      row.style.display = name.indexOf(q) !== -1 ? '' : 'none';
    });
  });

  el.querySelectorAll('.ss-member-row[data-member-id]').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
      showProfilePopup(row.dataset.memberId);
    });
  });

  if (ssIsOwner) {
    el.querySelectorAll('.ss-member-role-select').forEach(function(sel) {
      sel.addEventListener('change', async function() {
        var memberId = sel.dataset.memberId;
        var roleId = sel.value;
        for (var ri = 0; ri < (currentServer.roles || []).length; ri++) {
          var r = currentServer.roles[ri];
          if ((r.memberIds || []).indexOf(memberId) !== -1) {
            r.memberIds = r.memberIds.filter(function(id) { return id !== memberId; });
            try { await window.api.serverRemoveRole(currentServer.id, r.id, memberId); } catch {}
          }
        }
        if (roleId) {
          await window.api.serverAssignRole(currentServer.id, roleId, memberId);
          var role = currentServer.roles?.find(function(r) { return r.id === roleId; });
          if (role) { if (!role.memberIds) role.memberIds = []; role.memberIds.push(memberId); }
        }
      });
    });
  }
}

document.getElementById('close-server-settings')?.addEventListener('click', () => {
  document.getElementById('server-settings-overlay')?.classList.add('hidden');
});

// ── Members Sidebar ──
async function showMembersSidebar() {
  const sidebar = ensureMembersSidebar();
  if (!sidebar || !currentServer) { hideMembersSidebar(); return; }
  sidebar.innerHTML = '';
  sidebar.classList.remove('hidden');
  sidebar.classList.add('mobile-open');
  if (window.innerWidth <= 768) {
    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = 'padding:10px 8px;cursor:pointer;font-size:13px;color:var(--text-muted);display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(0,0,0,0.15)';
    closeBtn.innerHTML = '✕ <span>' + t('toggleMembers') + '</span>';
    closeBtn.addEventListener('click', function() { hideMembersSidebar(); });
    sidebar.appendChild(closeBtn);
  }
  const roles = currentServer.roles || [];
  var membersRes = await window.api.serverGetMembers(currentServer.id);
  var resolvedMembers = (Array.isArray(membersRes) ? membersRes : (membersRes?.users || [])).map(function(u) { return u || null; }).filter(Boolean);
  if (!resolvedMembers.length) {
    var rawMembers = currentServer.members || [];
    resolvedMembers = rawMembers.map(function(id) {
      if (typeof id !== 'string') return id;
      if (id === currentUser?.id) return currentUser;
      return { id: id, username: 'Unbekannt', status: 'offline' };
    });
  }
  const statusOrder = { online: 0, idle: 1, dnd: 2, invisible: 3, offline: 3 };
  const statusColors = { online: '#3ba55d', idle: '#f0b232', dnd: '#ed4245', invisible: '#80848e', offline: '#80848e' };

  const grouped = {};
  const noRole = [];
  for (const m of resolvedMembers) {
    const memberId = m.id || m.userId;
    let assigned = false;
    for (const role of roles) {
      if (role.memberIds?.includes(memberId)) {
        if (!grouped[role.id]) grouped[role.id] = { role: role, members: [] };
        grouped[role.id].members.push(m);
        assigned = true;
        break;
      }
    }
    if (!assigned) noRole.push(m);
  }

  function sortMembers(arr) {
    return arr.sort(function(a, b) {
      const sa = statusOrder[a.status || 'online'] ?? 3;
      const sb = statusOrder[b.status || 'online'] ?? 3;
      return sa - sb;
    });
  }

  function buildMemberEl(m, roleColor) {
    const memberId = m.id || m.userId;
    const name = m.username || getAuthorNameSync(memberId);
    const avatar = m.avatarPath ? toFileUrl(m.avatarPath) : defaultAvatar(name[0]);
    const status = m.status || 'online';
    const dotColor = statusColors[status] || statusColors.offline;
    const isOwner = m.is_owner;
    const el = document.createElement('div');
    el.className = 'member-item' + (isOwner ? ' owner' : '');
    el.innerHTML =
      '<div style="position:relative;flex-shrink:0">' +
        '<img class="member-avatar" src="' + avatar + '" alt="" />' +
        '<div class="member-status-dot" style="background:' + dotColor + ';border:2px solid var(--bg-list)"></div>' +
      '</div>' +
      '<span class="member-name" style="color:' + (roleColor || 'var(--text-muted)') + '">' + escHtml(name) + '</span>';
    el.addEventListener('click', function() { showProfilePopup(memberId); });
    return el;
  }

  for (const roleId of Object.keys(grouped)) {
    const data = grouped[roleId];
    const sorted = sortMembers(data.members);
    const onlineCount = sorted.filter(function(m) { return (m.status || 'online') !== 'offline' && (m.status || 'online') !== 'invisible'; }).length;
    const groupDiv = document.createElement('div');
    groupDiv.className = 'member-group';
    groupDiv.innerHTML = '<div class="member-group-label" style="color:' + data.role.color + '">' + escHtml(data.role.name) + ' \u2014 ' + onlineCount + '/' + sorted.length + '</div>';
    for (const m of sorted) {
      groupDiv.appendChild(buildMemberEl(m, data.role.color));
    }
    sidebar.appendChild(groupDiv);
  }

  if (noRole.length > 0) {
    const sorted = sortMembers(noRole);
    const onlineCount = sorted.filter(function(m) { return (m.status || 'online') !== 'offline' && (m.status || 'online') !== 'invisible'; }).length;
    const groupDiv = document.createElement('div');
    groupDiv.className = 'member-group';
    groupDiv.innerHTML = '<div class="member-group-label">' + t('membersCount') + ' \u2014 ' + onlineCount + '/' + sorted.length + '</div>';
    for (const m of sorted) {
      groupDiv.appendChild(buildMemberEl(m, null));
    }
    sidebar.appendChild(groupDiv);
  }
}

function hideMembersSidebar() {
  const sidebar = document.getElementById('members-sidebar');
  if (sidebar) {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('mobile-open');
  }
}

function toggleMembersSidebar() {
  const sidebar = document.getElementById('members-sidebar');
  if (!sidebar || !currentServer) return;
  if (sidebar.classList.contains('hidden')) showMembersSidebar();
  else hideMembersSidebar();
}

// ── Profile Popup ──
function showProfilePopup(targetUserId) {
  const overlay = ensureProfilePopup();
  let userInfo = getMemberById(targetUserId);
  if (!userInfo || !userInfo.avatarPath) {
    const cached = authorAvatarCache[targetUserId];
    if (cached) userInfo = { ...(userInfo || {}), avatarPath: cached };
    if (authorBannerCache[targetUserId]) userInfo = { ...(userInfo || {}), bannerPath: authorBannerCache[targetUserId] };
    if (authorStatusCache[targetUserId]) userInfo = { ...(userInfo || {}), status: authorStatusCache[targetUserId] };
  }
  const name = userInfo?.username || getAuthorNameSync(targetUserId);
  const avatar = (userInfo?.avatarPath ? toFileUrl(userInfo.avatarPath) : null) || defaultAvatar(name[0]);
  const bannerBg = userInfo?.bannerPath ? 'url("' + toFileUrl(userInfo.bannerPath) + '")' : 'var(--accent)';
  const aboutMe = userInfo?.aboutMe || t('noDescription');
  const rarity = userInfo?.rarityLabel || '';
  const rarityKey = userInfo?.rarityKey || '';
  const status = userInfo?.status || 'online';
  const statusColors = { online: '#3ba55d', idle: '#f0b232', dnd: '#ed4245', invisible: '#80848e', offline: '#80848e' };
  const statusLabels = { online: t('online'), idle: t('idle'), dnd: t('dnd'), invisible: t('invisible'), offline: t('invisible') };
  const dotColor = statusColors[status] || statusColors.offline;
  const isOwner = userInfo?.is_owner;
  const badgeHtml = isOwner ? '<span style="background:#f0b232;color:#000;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin-left:6px">OWNER</span>' : (userInfo?.isAdmin ? '<span style="background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin-left:6px">ADMIN</span>' : '');
  let rolesHtml = '';
  if (currentServer?.roles) {
    for (const role of currentServer.roles) {
      if (role.memberIds?.includes(targetUserId)) {
        rolesHtml += '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-input);border-radius:4px"><div style="width:12px;height:12px;border-radius:50%;background:' + role.color + ';flex-shrink:0"></div><span style="font-size:13px;color:var(--text-main)">' + escHtml(role.name) + '</span></div>';
      }
    }
  }
  const createdDate = userInfo?.createdAt ? new Date(userInfo.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  const hasBanner = !!userInfo?.bannerPath;

  const isOwnProfile = targetUserId === currentUser?.id;

  overlay.innerHTML = '<div class="profile-popup">' +
    '<div class="profile-popup-banner" style="' + (hasBanner ? 'background:url(\'' + toFileUrl(userInfo.bannerPath) + '\');background-size:cover;background-position:center' : 'background:' + bannerBg) + '"></div>' +
    '<div style="padding:0 16px 16px;text-align:center;position:relative">' +
      '<button id="profile-popup-close" style="position:absolute;top:-108px;right:8px;background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:18px;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1" title="Close">&times;</button>' +
      '<div style="position:relative;display:inline-block">' +
        '<img class="profile-popup-avatar" src="' + avatar + '" alt="" />' +
        '<div class="member-status-dot" style="position:absolute;bottom:2px;right:2px;background:' + dotColor + ';border:3px solid var(--bg-list);width:16px;height:16px;border-radius:50%"></div>' +
      '</div>' +
      '<div class="profile-popup-username" style="margin-top:8px">' + escHtml(name) + badgeHtml + '</div>' +
      '<div style="font-size:13px;color:var(--text-muted);margin-top:2px">' + escHtml(name) + ' ' + t('memberSince') + ' ' + (createdDate || t('unknown')) + ' ' + t('sinceDate') + '</div>' +
      '<div style="font-size:13px;color:var(--text-muted);margin-top:2px">' + escHtml(statusLabels[status] || 'Offline') + '</div>' +
      '<div style="border-top:1px solid var(--bg-primary);margin:12px 0"></div>' +
      (aboutMe && aboutMe !== t('noDescription') ? '<div style="text-align:left"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">' + t('aboutMeLabel') + '</div><div class="profile-popup-about">' + escHtml(aboutMe) + '</div></div>' : '') +
      (rarity ? '<div style="text-align:left;margin-top:8px"><span class="rarity-tag rarity-' + rarityKey + '">' + rarity + '</span></div>' : '') +
      (rolesHtml ? '<div style="text-align:left;margin-top:12px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">' + t('rolesLabel') + '</div><div style="display:flex;flex-wrap:wrap;gap:4px">' + rolesHtml + '</div></div>' : '') +
      (isOwnProfile ? '<button class="primary" id="profile-popup-edit" style="width:100%;margin-top:16px;padding:8px">' + t('editProfile') + '</button>' : '') +
    '</div></div>';
  overlay.classList.remove('hidden');
  overlay.addEventListener('click', function handler(e) {
    if (e.target === overlay) { overlay.classList.add('hidden'); overlay.removeEventListener('click', handler); }
  });
  document.getElementById('profile-popup-close')?.addEventListener('click', () => overlay.classList.add('hidden'));

  document.getElementById('profile-popup-edit')?.addEventListener('click', () => {
    overlay.classList.add('hidden');
    settingsOverlay?.classList.remove('hidden');
    buildSettingsNav();
    renderSettingsSection('account');
    navSetActive('account');
  });

  if (!userInfo || !userInfo.avatarPath || !userInfo.username) {
    (async function() {
      try {
        const result = await window.api.getUserById(targetUserId);
        if (result?.ok && result.user) {
          cacheUserData(result.user);
          const u = result.user;
          const newName = u.username || name;
          const newAvatar = u.avatarPath ? toFileUrl(u.avatarPath) : avatar;
          const newBanner = u.bannerPath ? toFileUrl(u.bannerPath) : null;
          const newStatus = u.status || status;
          const newDot = statusColors[newStatus] || statusColors.offline;
          const newAbout = u.aboutMe || t('noDescription');
          const newRarity = u.rarityLabel || '';
          const newRarityKey = u.rarityKey || '';
          const newIsOwner = u.is_owner;
          const newBadge = newIsOwner ? '<span style="background:#f0b232;color:#000;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin-left:6px">OWNER</span>' : (u.is_admin ? '<span style="background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;margin-left:6px">ADMIN</span>' : '');
          const newCreated = u.createdAt ? new Date(u.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' }) : (createdDate || t('unknown'));
          const popup = overlay.querySelector('.profile-popup');
          if (popup) {
            popup.querySelector('.profile-popup-banner').style.cssText = newBanner ? 'background:url(\'' + newBanner + '\');background-size:cover;background-position:center' : 'background:var(--accent)';
            popup.querySelector('.profile-popup-avatar').src = newAvatar;
            popup.querySelector('.member-status-dot').style.background = newDot;
            popup.querySelector('.profile-popup-username').innerHTML = escHtml(newName) + newBadge;
          }
        }
      } catch {}
    })();
  }
}

// ── Admin Panel ──
function openAdminPanel() {
  const overlay = document.getElementById('admin-overlay');
  if (!overlay) return;
  const stored = localStorage.getItem('adminAuth');
  if (stored) {
    document.getElementById('admin-login-form')?.classList.add('hidden');
    document.getElementById('admin-content')?.classList.remove('hidden');
    loadAdminUsers();
  } else {
    document.getElementById('admin-login-form')?.classList.remove('hidden');
    document.getElementById('admin-content')?.classList.add('hidden');
  }
  overlay.classList.remove('hidden');
}

document.getElementById('open-admin-panel')?.addEventListener('click', openAdminPanel);
document.getElementById('open-admin')?.addEventListener('click', openAdminPanel);
document.getElementById('close-admin')?.addEventListener('click', () => {
  document.getElementById('admin-overlay')?.classList.add('hidden');
});

document.getElementById('admin-login-btn')?.addEventListener('click', async () => {
  const pw = document.getElementById('admin-password')?.value;
  const errorEl = document.getElementById('admin-error');
  const hintEl = document.getElementById('admin-first-hint');
  if (errorEl) errorEl.textContent = '';
  if (hintEl) hintEl.classList.add('hidden');
  const result = await window.api.adminLogin(pw);
  if (!result?.ok) {
    if (result?.firstTime) {
      if (hintEl) { hintEl.textContent = t('adminFirstTime'); hintEl.classList.remove('hidden'); }
    }
    if (errorEl) errorEl.textContent = result?.error || t('error');
    return;
  }
  if (result.firstTime) await window.api.adminSetPassword(pw);
  localStorage.setItem('adminAuth', '1');
  document.getElementById('admin-login-form')?.classList.add('hidden');
  document.getElementById('admin-content')?.classList.remove('hidden');
  loadAdminUsers();
});

async function loadAdminUsers() {
  const users = (await window.api.adminGetAllUsers()) || [];
  const list = document.getElementById('admin-user-list');
  const count = document.getElementById('admin-user-count');
  if (count) count.textContent = users.length + ' ' + t('usersRegistered');
  if (!list) return;
  list.innerHTML = '';
  users.forEach(function(u) { renderAdminUserCard(list, u); });
}

function renderAdminUserCard(container, u) {
  const avatar = u.avatarPath ? toFileUrl(u.avatarPath) : defaultAvatar((u.username || '?')[0]);
  const created = new Date(u.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: 'long', year: 'numeric' });
  const card = document.createElement('div');
  card.className = 'admin-user-card';
  card.innerHTML = '<img class="admin-user-avatar" src="' + avatar + '" alt="" />' +
    '<div class="admin-user-info">' +
      '<div class="admin-user-name">' + escHtml(u.username) + ' <span class="rarity-tag rarity-' + u.rarityKey + '" style="font-size:10px">' + u.rarityLabel + '</span>' + (u.is_owner ? ' <span style="color:#f0b232;font-size:10px;font-weight:700">OWNER</span>' : u.is_admin ? ' <span style="color:#da373c;font-size:10px">ADMIN</span>' : '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted)">IP: ' + (u.lastIP || '\u2014') + ' \u00B7 ' + t('registered') + ': ' + created + '</div>' +
      (u.aboutMe ? '<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-top:2px">"' + escHtml(u.aboutMe) + '"</div>' : '') +
      '<div style="margin-top:6px;display:flex;gap:6px">' +
        (u.is_owner ? '' : '<button class="btn-small" data-action="toggle-admin" data-uid="' + u.id + '">' + (u.is_admin ? t('revokeAdmin') : t('makeAdmin')) + '</button>') +
        (u.is_owner ? '' : '<button class="btn-small-danger" data-action="delete" data-uid="' + u.id + '">' + t('delete') + '</button>') +
      '</div></div>';
  container.appendChild(card);
  card.querySelectorAll('[data-action]').forEach(function(btn) {
    btn.addEventListener('click', async () => {
      if (btn.dataset.action === 'toggle-admin') { await window.api.adminToggleAdmin(btn.dataset.uid, currentUser.id); loadAdminUsers(); }
      else if (btn.dataset.action === 'delete') { if (confirm(t('confirmDeleteUser'))) { await window.api.adminDeleteUser(btn.dataset.uid, currentUser.id); loadAdminUsers(); } }
    });
  });
}

document.getElementById('admin-search')?.addEventListener('input', async (e) => {
  const q = e.target.value.trim().toLowerCase();
  const users = (await window.api.adminGetAllUsers()) || [];
  const filtered = q ? users.filter(function(u) { return u.username.toLowerCase().includes(q); }) : users;
  const list = document.getElementById('admin-user-list');
  const count = document.getElementById('admin-user-count');
  if (count) count.textContent = filtered.length + ' ' + t('users');
  if (!list) return;
  list.innerHTML = '';
  filtered.forEach(function(u) { renderAdminUserCard(list, u); });
});

// ── Settings: Helper ──
function sGet(key) { return currentUser?.[key]; }
async function sSet(patch) {
  const r = await window.api.updateProfile(userId, patch);
  if (r?.ok && r.user) currentUser = r.user;
  else if (r?.ok) { try { const f = await window.api.getProfile(userId); if (f?.ok) currentUser = f.user; } catch(e) {} }
  return r;
}
var _pendingChanges = {};
var _hasPendingChanges = false;
function queueChange(patch) {
  Object.keys(patch).forEach(function(key) {
    if (patch[key] !== null && typeof patch[key] === 'object' && !Array.isArray(patch[key]) && _pendingChanges[key] !== null && typeof _pendingChanges[key] === 'object' && !Array.isArray(_pendingChanges[key])) {
      Object.assign(_pendingChanges[key], patch[key]);
    } else {
      _pendingChanges[key] = patch[key];
    }
  });
  _hasPendingChanges = true;
  showSaveBar();
}
function showSaveBar() {
  var bar = document.getElementById('settings-save-bar');
  if (bar) {
    bar.style.display = 'flex';
    var txt = document.getElementById('settings-save-bar-text');
    var resetBtn = document.getElementById('settings-reset-pending');
    var saveBtn = document.getElementById('settings-save-pending');
    if (txt) txt.textContent = t('unsavedChanges');
    if (resetBtn) resetBtn.textContent = t('resetBtn');
    if (saveBtn) saveBtn.textContent = t('saveChanges');
  }
}
function hideSaveBar() { var bar = document.getElementById('settings-save-bar'); if (bar) { bar.style.display = 'none'; } _pendingChanges = {}; _hasPendingChanges = false; }
document.getElementById('settings-save-pending')?.addEventListener('click', async function() {
  var p = Object.assign({}, _pendingChanges);
  hideSaveBar();
  await sSet(p);
  applyProfileToUI();
  applyBackground();
  applyAccessibility();
  var sect = document.querySelector('.settings-nav-item.active');
  if (sect) renderSettingsSection(sect.dataset.section);
});
document.getElementById('settings-reset-pending')?.addEventListener('click', function() {
  hideSaveBar();
  applyProfileToUI();
  applyBackground();
  applyAccessibility();
  var sect = document.querySelector('.settings-nav-item.active');
  if (sect) renderSettingsSection(sect.dataset.section);
});
function toggleHTML(id, checked) {
  return '<label class="toggle-switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="toggle-slider"></span></label>';
}
function dropdownHTML(id, options, selected) {
  var h = '<select class="settings-dropdown" id="' + id + '">';
  options.forEach(function(o) { h += '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>'; });
  return h + '</select>';
}

// ── Settings: Open / Close ──
const settingsOverlay = document.getElementById('settings-overlay');
document.getElementById('open-settings')?.addEventListener('click', () => {
  closeMobileMenu();
  settingsOverlay?.classList.remove('hidden');
  buildSettingsNav();
});
document.getElementById('mobile-open-settings')?.addEventListener('click', () => {
  closeMobileMenu();
  settingsOverlay?.classList.remove('hidden');
  buildSettingsNav();
});
document.getElementById('close-settings')?.addEventListener('click', () => {
  settingsOverlay?.classList.add('hidden');
});

// ── User Panel: Avatar klick -> ProfilPopup (Discord-Style) ──
document.getElementById('user-avatar')?.addEventListener('click', () => {
  showProfilePopup(userId);
});

// ── User Panel: Status klick -> Status wechseln ──
document.getElementById('user-status-dot')?.addEventListener('click', async function(e) {
  e.stopPropagation();
  var existing = document.getElementById('status-popup');
  if (existing) { existing.remove(); return; }
  var popup = document.createElement('div');
  popup.id = 'status-popup';
  popup.style.cssText = 'position:absolute;bottom:56px;left:8px;background:var(--bg-list);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.24);z-index:200;width:200px';
  var statuses = [
    { key: 'online', color: '#23a55a', label: 'Online' },
    { key: 'idle', color: '#f0b232', label: 'Abwesend' },
    { key: 'dnd', color: '#f23f43', label: 'Nicht stoeren' },
    { key: 'invisible', color: '#80848e', label: 'Unsichtbar' }
  ];
  popup.innerHTML = statuses.map(function(s) {
    return '<div data-status="' + s.key + '" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--text-main)">' +
      '<div style="width:10px;height:10px;border-radius:50%;background:' + s.color + ';flex-shrink:0"></div>' + s.label + '</div>';
  }).join('');
  var panel = document.getElementById('user-panel');
  if (panel) panel.appendChild(popup);
  popup.addEventListener('click', async function(ev) {
    var opt = ev.target.closest('[data-status]');
    if (!opt) return;
    await sSet({ status: opt.dataset.status });
    popup.remove();
  });
  setTimeout(function() { document.addEventListener('click', function h() { popup.remove(); document.removeEventListener('click', h); }); }, 10);
});

// ── User Panel: Mic/Deafen Toggle ──
var micMuted = false;
var deafened = false;
document.getElementById('user-panel-mic')?.addEventListener('click', function() {
  micMuted = !micMuted;
  this.style.color = micMuted ? '#f23f43' : '';
  this.innerHTML = micMuted
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
});
document.getElementById('user-panel-deafen')?.addEventListener('click', function() {
  deafened = !deafened;
  this.style.color = deafened ? '#f23f43' : '';
  this.innerHTML = deafened
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/></svg>';
});

// ── Network URL ──
document.getElementById('show-network-url')?.addEventListener('click', async () => {
  var ip = await window.api.getIP();
  var localUrl = 'http://' + ip + ':3000';
  prompt(
    t('networkLocal') + '\n' + localUrl +
    '\n\n' + t('networkTunnel') + '\n' +
    'cd "' + (isElectron ? '' : '') + '" && npm run tunnel' +
    '\n' + t('networkShare'),
    localUrl
  );
});

// ── Settings: Nav ──
function buildSettingsNav() {
  const nav = document.getElementById('settings-nav');
  const content = document.getElementById('settings-content-inner');
  if (!nav || !content) return;
  nav.innerHTML = '';
  content.innerHTML = '';

  const sections = [
    { id: 'account', label: '👤 ' + t('navMyAccount') },
    { id: 'profile', label: '🖼️ ' + t('navProfile') },
    { id: 'notifications', label: '🔔 ' + t('navNotifications') },
    { id: 'privacy', label: '🔒 ' + t('navPrivacy') },
    { id: 'accessibility', label: '♿ ' + t('navAccessibility') },
    { id: 'language', label: '🌍 ' + t('navLanguage') },
    { id: 'keybinds', label: '⌨️ ' + t('navKeybinds') },
    { id: 'voicevideo', label: '🎤 ' + t('navVoiceVideo') },
    { id: 'appearance', label: '🎨 ' + t('navAppearance') },
    { id: 'advanced', label: '🔧 ' + t('navAdvanced') },
    { id: 'reset', label: '🔄 ' + t('navReset'), danger: true }
  ];
  if (currentUser?.is_owner || currentUser?.is_admin) sections.push({ id: 'admin', label: '🛡️ ' + t('navAdminPanel') });
  sections.push({ id: 'switchuser', label: '🔄 ' + t('switchUser') });
  sections.push({ id: 'logout', label: '🚪 ' + t('navLogout'), danger: true });

  sections.forEach(function(s, i) {
    var item = document.createElement('div');
    item.className = 'settings-nav-item' + (s.danger ? ' danger' : '') + (i === 0 ? ' active' : '');
    item.dataset.section = s.id;
    item.textContent = s.label || s.header;
    nav.appendChild(item);
  });

  renderSettingsSection('account');
  nav.querySelectorAll('.settings-nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      if (_hasPendingChanges) { if (!confirm('Ungespeicherte Änderungen verwerfen?')) return; }
      hideSaveBar();
      nav.querySelectorAll('.settings-nav-item').forEach(function(n) { n.classList.remove('active'); });
      item.classList.add('active');
      renderSettingsSection(item.dataset.section);
    });
  });
}

// ── Settings: Render Panels ──
function renderSettingsSection(id) {
  const content = document.getElementById('settings-content-inner');
  if (!content) return;
  content.innerHTML = '';
  var fn = settingsSections[id];
  if (fn) fn(content);
}

const settingsSections = {};

settingsSections.account = function(el) {
  var avatarSrc = currentUser?.avatarPath ? toFileUrl(currentUser.avatarPath) : defaultAvatar(currentUser?.username?.[0] || '?');
  var accentClr = currentUser?.accentColor || '#5865f2';
  var regDate = currentUser?.createdAt ? new Date(currentUser.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  var regTime = currentUser?.createdAt ? new Date(currentUser.createdAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
  var email = currentUser?.email || t('notSpecified');
  var phone = currentUser?.phone || t('notSpecified');
  var statusColors = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e' };
  var statusLabels = { online: t('statusOnline'), idle: t('statusIdle'), dnd: t('statusDnd'), invisible: t('statusInvisible') };
  var curStatus = currentUser?.status || 'online';
  var accountType = currentUser?.is_owner ? t('owner') : (currentUser?.is_admin ? t('admin') : t('user'));
  var accountBadgeColor = currentUser?.is_owner ? '#f0b232' : (currentUser?.is_admin ? '#da373c' : '#5865f2');
  var servers = allServers.filter(s => s.members && s.members.some(m => (m.id || m.userId) === userId));

  el.innerHTML =
    '<div class="settings-section-title">' + t('navMyAccount') + '</div>' +

    // Banner + Avatar Card
    '<div class="settings-card" style="padding:0;overflow:hidden;border:none">' +
      '<div style="height:120px;background:linear-gradient(135deg, #5865f2, #eb459e);position:relative;overflow:hidden" id="s-banner-wrap">' +
        '<img id="s-banner-img" style="width:100%;height:100%;object-fit:cover;display:none" />' +
        '<button id="s-pick-banner" style="position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2" title="' + t('changeBanner') + '">📷</button>' +
      '</div>' +
      '<div style="padding:16px 20px 20px;background:var(--bg-chat);position:relative">' +
        '<div style="display:flex;align-items:flex-end;gap:16px;margin-top:-50px">' +
          '<div style="position:relative">' +
            '<img id="s-avatar" src="' + avatarSrc + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:' + accentClr + ';border:6px solid var(--bg-chat)" />' +
            '<button id="s-pick-avatar" style="position:absolute;bottom:0;right:0;width:28px;height:28px;border-radius:50%;background:var(--bg-input);border:3px solid var(--bg-chat);color:var(--text-main);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0" title="' + t('changeAvatar') + '">📷</button>' +
          '</div>' +
          '<div style="flex:1;padding-bottom:4px">' +
            '<div style="font-size:20px;font-weight:700;line-height:1.2">' + escHtml(currentUser?.username || '') + '</div>' +
            '<div style="font-size:13px;color:var(--text-muted);display:flex;align-items:center;gap:6px">' +
              escHtml(currentUser?.rarityLabel || '') +
              ' <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;background:' + accountBadgeColor + ';color:' + (currentUser?.is_owner ? '#000' : '#fff') + '">' + accountType.toUpperCase() + '</span>' +
            '</div>' +
          '</div>' +
          '<button class="primary" id="s-open-profile" style="padding:6px 16px;font-size:13px">' + t('editProfile') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ── Ueber mich ──
    '<div class="settings-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<div class="settings-label" style="margin:0">' + t('aboutMe') + '</div>' +
        '<button class="secondary" id="s-edit-aboutme" style="padding:4px 12px;font-size:12px">' + t('edit') + '</button>' +
      '</div>' +
      '<div id="s-aboutme-display" style="font-size:14px;color:var(--text-main);padding:12px;background:var(--bg-input);border-radius:6px;min-height:40px;white-space:pre-wrap">' +
        (currentUser?.aboutMe ? escHtml(currentUser.aboutMe) : '<span style="color:var(--text-muted);font-style:italic">' + t('aboutMePlaceholder') + '</span>') +
      '</div>' +
    '</div>' +

    // ── Status ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:12px">' + t('status') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap" id="s-status-picker">' +
        Object.keys(statusColors).map(function(key) {
          var isActive = curStatus === key;
          return '<div data-status="' + key + '" style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:6px;cursor:pointer;border:2px solid ' + (isActive ? statusColors[key] : 'var(--bg-input)') + ';background:' + (isActive ? statusColors[key] + '22' : 'var(--bg-input)') + ';transition:all .15s">' +
            '<div style="width:12px;height:12px;border-radius:50%;background:' + statusColors[key] + ';flex-shrink:0"></div>' +
            '<span style="font-size:13px;color:var(--text-main);font-weight:' + (isActive ? '600' : '400') + '">' + statusLabels[key] + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +

    // ── Akzentfarbe ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:4px">' + t('accentColor') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + t('accentColorDesc') + '</div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<input type="color" id="s-accent-color" value="' + escHtml(accentClr) + '" style="width:40px;height:40px;border:none;border-radius:50%;cursor:pointer;background:none;padding:0" />' +
        '<span style="font-size:13px;color:var(--text-main);font-family:monospace">' + escHtml(accentClr) + '</span>' +
        '<button class="secondary" id="s-save-accent" style="padding:4px 12px;font-size:12px">' + t('save') + '</button>' +
      '</div>' +
    '</div>' +

    // ── Benutzername ──
    '<div class="settings-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div><div class="settings-label">' + t('username') + '</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + t('changeUsernameDesc') + '</div><div style="margin-top:4px;font-size:15px;color:var(--text-main)">' + escHtml(currentUser?.username || '') + '</div></div>' +
        '<button class="primary" id="s-change-username" style="padding:6px 16px;font-size:13px">' + t('edit') + '</button>' +
      '</div>' +
    '</div>' +

    // ── E-Mail ──
    '<div class="settings-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div><div class="settings-label">' + t('emailLabel') + '</div><div style="margin-top:4px;font-size:15px;color:var(--text-main)">' + escHtml(email) + '</div>' +
          '<div style="margin-top:4px;font-size:12px;color:' + (currentUser?.emailVerified ? '#3ba55d' : '#faa61a') + '">' + (currentUser?.emailVerified ? '✅ ' + t('emailVerified') : '⚠️ ' + t('emailNotVerified')) + '</div>' +
        '</div>' +
        (currentUser?.emailVerified
          ? '<button class="secondary" id="s-change-email" style="padding:6px 16px;font-size:13px">' + t('changeEmail') + '</button>'
          : '<button class="primary" id="s-verify-email-btn" style="padding:6px 16px;font-size:13px">' + t('verifyEmail') + '</button>') +
      '</div>' +
    '</div>' +

    // ── Telefonnummer ──
    '<div class="settings-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div><div class="settings-label">' + t('phone') + '</div><div style="margin-top:4px;font-size:15px;color:var(--text-main)">' + escHtml(phone) + '</div></div>' +
        '<button class="primary" id="s-change-phone" style="padding:6px 16px;font-size:13px">' + t('edit') + '</button>' +
      '</div>' +
    '</div>' +

    // ── Passwort ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:12px">' + t('passwordSecurity') + '</div>' +
      '<input type="password" class="settings-input" id="pw-old" placeholder="' + t('currentPassword') + '" />' +
      '<input type="password" class="settings-input" id="pw-new" placeholder="' + t('newPassword') + '" style="margin-top:8px" />' +
      '<p class="error" id="pw-error"></p>' +
      '<button class="settings-btn settings-btn-primary" id="pw-change-btn" style="margin-top:8px">' + t('changePassword') + '</button>' +
    '</div>' +

    // ── Zwei-Faktor-Auth ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:4px">' + t('twoFactorAuth') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + t('twoFactorDesc') + '</div>' +
      (currentUser?.twoFactorEnabled
        ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div style="width:10px;height:10px;border-radius:50%;background:#3ba55d"></div><span style="color:#3ba55d;font-weight:600;font-size:14px">' + t('twoFactorEnabled') + '</span></div>' +
          '<div class="settings-label">' + t('twoFactorDisable') + '</div>' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">' + t('enterCodeFromApp') + '</div>' +
          '<div style="display:flex;gap:8px;align-items:center"><input type="text" class="settings-input" id="s-2fa-disable-code" placeholder="' + t('sixDigitCode') + '" maxlength="6" style="width:180px;letter-spacing:4px;text-align:center;font-size:18px" />' +
          '<button class="btn-danger" id="s-2fa-disable-btn">' + t('disable') + '</button></div>' +
          '<p class="error" id="s-2fa-disable-error" style="margin-top:6px"></p>'
        : '<div id="s-2fa-setup-area">' +
          '<button class="primary" id="s-2fa-setup-btn">' + t('twoFactorActivate') + '</button>' +
          '</div>'
      ) +
    '</div>' +

    // ── Kontoinformationen ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:12px">' + t('accountInfo') + '</div>' +

      // Benutzer-ID
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg-primary)">' +
        '<div><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase">' + t('userIdLabel') + '</div><div style="font-size:14px;color:var(--text-main);font-family:monospace;margin-top:2px;user-select:all">' + escHtml(currentUser?.id || '') + '</div></div>' +
        '<button class="secondary" id="s-copy-id" style="padding:4px 12px;font-size:12px">' + t('copyId') + '</button>' +
      '</div>' +

      // Kontotyp
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg-primary)">' +
        '<div style="font-size:13px;color:var(--text-muted)">' + t('accountType') + '</div>' +
        '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:' + accountBadgeColor + ';color:' + (currentUser?.is_owner ? '#000' : '#fff') + '">' + accountType + '</span>' +
      '</div>' +

      // Seltenheit
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg-primary)">' +
        '<div style="font-size:13px;color:var(--text-muted)">' + t('rarity') + '</div>' +
        '<span class="rarity-tag rarity-' + escHtml(currentUser?.rarityKey || '') + '">' + escHtml(currentUser?.rarityLabel || '') + '</span>' +
      '</div>' +

      // Erstellt am
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg-primary)">' +
        '<div style="font-size:13px;color:var(--text-muted)">' + t('accountCreated') + '</div>' +
        '<span style="font-size:13px;color:var(--text-main)">' + regDate + ' ' + regTime + '</span>' +
      '</div>' +

      // Letzte IP
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">' +
        '<div style="font-size:13px;color:var(--text-muted)">' + t('lastIP') + '</div>' +
        '<span style="font-size:13px;color:var(--text-main);font-family:monospace">' + escHtml(currentUser?.lastIP || '—') + '</span>' +
      '</div>' +
    '</div>' +

    // ── Beigetretene Server ──
    '<div class="settings-card">' +
      '<div class="settings-label" style="margin-bottom:12px">' + t('joinedServers') + '</div>' +
      (servers.length > 0
        ? servers.map(function(s) {
            var memberCount = s.members ? s.members.length : 0;
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-input);border-radius:6px;margin-bottom:6px">' +
              '<div style="width:36px;height:36px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;flex-shrink:0">' + escHtml((s.name || '?')[0].toUpperCase()) + '</div>' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:14px;font-weight:600;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(s.name || '') + '</div>' +
                '<div style="font-size:11px;color:var(--text-muted)">' + memberCount + ' ' + t('members').toLowerCase() + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div style="text-align:center;padding:16px;font-size:13px;color:var(--text-muted)">' + t('noServers') + '</div>'
      ) +
    '</div>' +

    // ── Gefahrenbereich ──
    '<div class="settings-card" style="border:1px solid #f23f43">' +
      '<div class="settings-label" style="color:#f23f43;margin-bottom:4px">' + t('dangerZone') + '</div>' +
      '<div class="settings-label" style="color:#f23f43">' + t('removeAccount') + '</div>' +
      '<div style="font-size:13px;color:var(--text-muted);margin-top:4px;margin-bottom:12px">' + t('removeAccountDesc') + '</div>' +
      '<button class="btn-danger" id="s-delete-account">' + t('deleteAccount') + '</button>' +
    '</div>';

  // Banner anzeigen
  var bImg = document.getElementById('s-banner-img');
  if (currentUser?.bannerPath) {
    if (bImg) { bImg.src = toFileUrl(currentUser.bannerPath); bImg.style.display = 'block'; }
  }

  document.getElementById('s-pick-avatar')?.addEventListener('click', async function() {
    var r = await window.api.pickImage('avatar');
    if (r?.ok) { await sSet({ avatarPath: r.path }); applyProfileToUI(); renderSettingsSection('account'); }
  });
  document.getElementById('s-pick-banner')?.addEventListener('click', async function() {
    var r = await window.api.pickImage('banner');
    if (r?.ok) { await sSet({ bannerPath: r.path }); applyProfileToUI(); renderSettingsSection('account'); }
  });
  document.getElementById('s-open-profile')?.addEventListener('click', function() { renderSettingsSection('profile'); navSetActive('profile'); });

  // Benutzername aendern
  document.getElementById('s-change-username')?.addEventListener('click', async function() {
    showInlineModal(el, t('changeUsername'), [
      { label: t('newUsername'), id: 'modal-username-input', value: currentUser?.username || '' }
    ], async function(values) {
      var newU = values['modal-username-input']?.trim();
      if (!newU || newU === currentUser?.username) return t('noChange');
      if (newU.length < 2 || newU.length > 32) return t('usernameLength');
      var check = await window.api.checkUsername(newU);
      if (check?.ok && check.taken) return t('usernameTaken');
      if (!check?.ok) return check?.error || t('invalidUsername');
      await sSet({ username: newU });
      renderSettingsSection('account');
      return null;
    });
  });

  // E-Mail aendern
  document.getElementById('s-change-email')?.addEventListener('click', async function() {
    showInlineModal(el, t('changeEmail'), [
      { label: t('newEmail'), id: 'modal-email-input', type: 'email', value: currentUser?.email || '' }
    ], async function(values) {
      var newE = values['modal-email-input']?.trim();
      if (!newE) return t('enterEmail');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newE)) return t('invalidEmail');
      var r = await window.api.emailChange(userId, newE);
      if (!r.ok) return r.error;
      currentUser.email = newE;
      currentUser.emailVerified = false;
      renderSettingsSection('account');
      return null;
    });
  });

  // E-Mail verifizieren
  document.getElementById('s-verify-email-btn')?.addEventListener('click', async function() {
    showInlineModal(el, t('verifyEmail'), [
      { label: t('email') + ' - Code', id: 'modal-verify-code', type: 'text', placeholder: '6-stelliger Code' }
    ], async function(values) {
      var code = values['modal-verify-code']?.trim();
      if (!code || code.length !== 6) return t('sixDigitCode');
      var r = await window.api.emailVerify(userId, code);
      if (!r.ok) return r.error;
      currentUser.emailVerified = true;
      renderSettingsSection('account');
      return null;
    });
    // resend link
    var resendBtn = document.createElement('button');
    resendBtn.textContent = t('resendCode');
    resendBtn.style.cssText = 'background:none;border:none;color:#5865f2;cursor:pointer;font-size:13px;margin-top:8px';
    resendBtn.addEventListener('click', async function() {
      resendBtn.textContent = '...';
      resendBtn.disabled = true;
      try {
        var r = await window.api.emailResend(userId);
        if (r.ok) {
          if (r.code) {
            var devInfo = document.createElement('div');
            devInfo.style.cssText = 'font-size:12px;color:#faa61a;margin-top:4px';
            devInfo.textContent = t('devModeCode') + r.code;
            resendBtn.parentNode.insertBefore(devInfo, resendBtn.nextSibling);
          }
          if (r.devMode) {
            var errMsg = document.createElement('div');
            errMsg.style.cssText = 'font-size:12px;color:#faa61a;margin-top:2px';
            errMsg.textContent = t('emailSendFailed');
            devInfo.parentNode.insertBefore(errMsg, devInfo.nextSibling);
          } else {
            var okMsg = document.createElement('div');
            okMsg.style.cssText = 'font-size:12px;color:#3ba55d;margin-top:4px';
            okMsg.textContent = t('codeSentTo') + ' ' + currentUser.email;
            resendBtn.parentNode.insertBefore(okMsg, resendBtn.nextSibling);
          }
          setTimeout(() => { resendBtn.textContent = t('resendCode'); }, 3000);
        }
      } finally {
        resendBtn.textContent = t('resendCode');
        resendBtn.disabled = false;
      }
    });
    var modalActions = el.querySelector('.modal-actions');
    if (modalActions) modalActions.parentNode.insertBefore(resendBtn, modalActions.nextSibling);
  });

  // Telefonnummer aendern
  document.getElementById('s-change-phone')?.addEventListener('click', async function() {
    showInlineModal(el, t('changePhone'), [
      { label: t('newPhone'), id: 'modal-phone-input', type: 'tel', value: currentUser?.phone || '' }
    ], async function(values) {
      var newP = values['modal-phone-input']?.trim();
      if (!newP) return t('enterPhone');
      if (newP.length < 5) return t('invalidPhone');
      await sSet({ phone: newP });
      renderSettingsSection('account');
      return null;
    });
  });

  // 2FA Setup
  document.getElementById('s-2fa-setup-btn')?.addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = t('settingUp');
    var res = await window.api.twoFASetup(currentUser.id);
    if (!res?.ok) { btn.disabled = false; btn.textContent = t('twoFactorActivate'); alert(res?.error || t('error')); return; }
    var area = document.getElementById('s-2fa-setup-area');
    if (!area) return;
    area.innerHTML =
      '<div style="background:var(--bg-input);border-radius:8px;padding:12px;margin-bottom:16px;text-align:center">' +
        '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">' + t('twoFAForAccount') + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:var(--text-main)">' + escHtml(currentUser?.username || '') + '</div>' +
      '</div>' +
      '<div style="text-align:center;margin-bottom:16px">' +
        '<img src="' + res.qrCode + '" style="width:220px;height:220px;border-radius:12px;background:#fff;padding:12px" />' +
      '</div>' +
      '<div style="text-align:center;margin-bottom:16px">' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">' + t('orEnterSecret') + '</div>' +
        '<code style="background:var(--bg-input);padding:8px 16px;border-radius:6px;font-size:14px;letter-spacing:2px;display:inline-block;cursor:pointer" id="s-2fa-secret" title="' + t('clickToCopy') + '">' + escHtml(res.secret) + '</code>' +
      '</div>' +
      '<div style="text-align:center">' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">' + t('enterCodeFromApp2') + '</div>' +
        '<input type="text" id="s-2fa-verify-code" placeholder="' + t('sixDigitCode') + '" maxlength="6" style="width:180px;letter-spacing:4px;text-align:center;font-size:18px;background:var(--bg-input);color:var(--text-main);border:1px solid var(--border);border-radius:6px;padding:10px" />' +
        '<p class="error" id="s-2fa-verify-error" style="margin-top:8px"></p>' +
        '<button class="primary" id="s-2fa-verify-btn" style="margin-top:8px;padding:8px 24px">' + t('verifyActivate') + '</button>' +
      '</div>';
    document.getElementById('s-2fa-secret')?.addEventListener('click', function() {
      navigator.clipboard?.writeText(this.textContent);
      this.style.background = 'var(--accent)';
      var self = this;
      setTimeout(function() { self.style.background = 'var(--bg-input)'; }, 1000);
    });
    document.getElementById('s-2fa-verify-btn')?.addEventListener('click', async function() {
      var code = document.getElementById('s-2fa-verify-code')?.value?.trim();
      var errEl = document.getElementById('s-2fa-verify-error');
      if (!code || code.length !== 6) { if (errEl) errEl.textContent = t('enterSixDigits'); return; }
      var vRes = await window.api.twoFAVerify(currentUser.id, code);
      if (vRes?.ok) {
        currentUser.twoFactorEnabled = true;
        alert(t('twoFAActivated'));
        renderSettingsSection('account');
      } else {
        if (errEl) errEl.textContent = vRes?.error || t('wrongCode');
      }
    });
  });

  // 2FA Deaktivieren
  document.getElementById('s-2fa-disable-btn')?.addEventListener('click', async function() {
    var code = document.getElementById('s-2fa-disable-code')?.value?.trim();
    var errEl = document.getElementById('s-2fa-disable-error');
    if (!code || code.length !== 6) { if (errEl) errEl.textContent = t('enterSixDigits'); return; }
    var dRes = await window.api.twoFADisable(currentUser.id, code);
    if (dRes?.ok) {
      currentUser.twoFactorEnabled = false;
      alert(t('twoFADeactivated'));
      renderSettingsSection('account');
    } else {
      if (errEl) errEl.textContent = dRes?.error || t('wrongCode');
    }
  });

  document.getElementById('s-delete-account')?.addEventListener('click', async function() {
    if (!confirm(t('confirmAccountDelete'))) return;
    if (!confirm(t('confirmAccountDelete2'))) return;
    await window.api.adminDeleteUser(userId);
    localStorage.removeItem('currentUserId');
    window.location.href = 'login.html';
  });

  document.getElementById('pw-change-btn')?.addEventListener('click', async function() {
    var oldPw = document.getElementById('pw-old')?.value;
    var newPw = document.getElementById('pw-new')?.value;
    var errEl = document.getElementById('pw-error');
    if (errEl) { errEl.textContent = ''; errEl.style.color = ''; }
    if (!oldPw || !newPw) { if (errEl) errEl.textContent = t('fillBothFields'); return; }
    if (newPw.length < 4) { if (errEl) errEl.textContent = t('passwordTooShort'); return; }
    try {
      var result = await window.api.changePassword(userId, oldPw, newPw);
      if (result?.ok) {
        if (errEl) { errEl.style.color = '#3ba55d'; errEl.textContent = t('passwordChanged'); }
        document.getElementById('pw-old').value = '';
        document.getElementById('pw-new').value = '';
      } else { if (errEl) errEl.textContent = result?.error || t('passwordChangeError'); }
    } catch(e) { if (errEl) errEl.textContent = t('passwordChangeError'); }
  });

  // ── Ueber mich bearbeiten ──
  document.getElementById('s-edit-aboutme')?.addEventListener('click', function() {
    showInlineModal(el, t('editAboutMe'), [
      { label: t('aboutMe'), id: 'modal-aboutme', value: currentUser?.aboutMe || '' }
    ], async function(values) {
      var newAbout = values['modal-aboutme']?.trim() || '';
      await sSet({ aboutMe: newAbout });
      renderSettingsSection('account');
      return null;
    });
  });

  // ── Status aendern ──
  document.getElementById('s-status-picker')?.addEventListener('click', async function(e) {
    var opt = e.target.closest('[data-status]');
    if (!opt) return;
    var newStatus = opt.dataset.status;
    await sSet({ status: newStatus });
    renderSettingsSection('account');
  });

  // ── Akzentfarbe ──
  document.getElementById('s-save-accent')?.addEventListener('click', async function() {
    var color = document.getElementById('s-accent-color')?.value || '#5865f2';
    await sSet({ accentColor: color });
    applyProfileToUI();
    renderSettingsSection('account');
  });

  // ── Benutzer-ID kopieren ──
  document.getElementById('s-copy-id')?.addEventListener('click', function() {
    var btn = this;
    navigator.clipboard?.writeText(currentUser?.id || '');
    btn.textContent = t('idCopied');
    btn.style.background = '#3ba55d';
    btn.style.color = '#fff';
    setTimeout(function() { btn.textContent = t('copyId'); btn.style.background = ''; btn.style.color = ''; }, 1500);
  });
};

function navSetActive(id) {
  var nav = document.getElementById('settings-nav');
  if (!nav) return;
  nav.querySelectorAll('.settings-nav-item').forEach(function(n) { n.classList.toggle('active', n.dataset.section === id); });
};

function showInlineModal(parentEl, title, fields, onSubmit) {
  var existing = document.getElementById('inline-modal-overlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'inline-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';
  var fieldsHtml = fields.map(function(f) {
    return '<label>' + escHtml(f.label) + '</label>' +
      '<input type="' + (f.type || 'text') + '" class="settings-input" id="' + f.id + '" value="' + escHtml(f.value || '') + '" placeholder="' + escHtml(f.label) + '" style="margin-top:6px;margin-bottom:8px" />';
  }).join('');
  overlay.innerHTML =
    '<div class="modal" style="width:400px">' +
      '<div class="modal-header"><h2>' + escHtml(title) + '</h2><button id="close-inline-modal">✕</button></div>' +
      '<div class="modal-body">' +
        fieldsHtml +
        '<p class="error" id="inline-modal-error"></p>' +
        '<button class="primary" id="inline-modal-submit" style="margin-top:4px">' + t('save') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('close-inline-modal')?.addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  var firstInput = overlay.querySelector('input');
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
  document.getElementById('inline-modal-submit')?.addEventListener('click', async function() {
    var values = {};
    fields.forEach(function(f) { values[f.id] = document.getElementById(f.id)?.value || ''; });
    var errEl = document.getElementById('inline-modal-error');
    try {
      var err = await onSubmit(values);
      if (err) { if (errEl) { errEl.textContent = err; errEl.style.color = ''; } return; }
      overlay.remove();
    } catch(e) { if (errEl) { errEl.textContent = t('error') + ': ' + e.message; errEl.style.color = ''; } }
  });
}

settingsSections.profile = function(el) {
  var n = currentUser?.notifications || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navProfile') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('status') + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;cursor:pointer" id="s-status-row">' +
        '<div id="s-status-dot" style="width:20px;height:20px;border-radius:50%"></div>' +
        '<span id="s-status-label" style="font-size:14px;color:var(--text-main)"></span>' +
      '</div>' +
    '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('accentColor') + '</div>' +
      '<input type="color" id="s-accent-color" value="' + (currentUser?.accentColor || '#5865f2') + '" style="margin-top:8px;width:60px;height:36px;border:none;background:none;cursor:pointer" />' +
    '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('banner') + '</div>' +
      '<div style="height:80px;border-radius:8px;background:' + (currentUser?.bannerPath ? 'url("' + toFileUrl(currentUser.bannerPath) + '") center/cover' : 'var(--accent)') + ';margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="settings-btn settings-btn-secondary" id="s-pick-banner">' + t('uploadBanner') + '</button>' +
          '<button class="settings-btn settings-btn-secondary" id="s-clear-banner" style="color:var(--text-muted)">' + t('removeBanner') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('aboutMe') + '</div>' +
      '<textarea class="about-me-input" id="s-about-me" maxlength="190" placeholder="' + t('aboutMePlaceholder') + '" style="margin-top:8px;width:100%">' + escHtml(currentUser?.aboutMe || '') + '</textarea>' +
    '</div>';

  var dot = document.getElementById('s-status-dot');
  var statusLabel = document.getElementById('s-status-label');
  var colors = { online: '#3ba55d', idle: '#f0b232', dnd: '#ed4245', invisible: '#80848e' };
  var labels = { online: t('online'), idle: t('idle'), dnd: t('dnd'), invisible: t('invisible') };
  var st = currentUser?.status || 'online';
  if (dot) dot.style.backgroundColor = colors[st];
  if (statusLabel) statusLabel.textContent = labels[st] || t('online');

  document.getElementById('s-status-row')?.addEventListener('click', function() { showStatusSelector(); });

  document.getElementById('s-accent-color')?.addEventListener('input', function(e) {
    clearTimeout(window._accentTimer);
    window._accentTimer = setTimeout(async function() { await sSet({ accentColor: e.target.value }); applyProfileToUI(); }, 300);
  });

  document.getElementById('s-pick-banner')?.addEventListener('click', async function() {
    var r = await window.api.pickImage('banner');
    if (r?.ok) { await sSet({ bannerPath: r.path, bannerType: r.isGif ? 'gif' : 'image' }); applyProfileToUI(); renderSettingsSection('profile'); }
  });
  document.getElementById('s-clear-banner')?.addEventListener('click', async function() {
    await sSet({ bannerPath: null, bannerType: null }); applyProfileToUI(); renderSettingsSection('profile');
  });

  var aboutTimer = null;
  document.getElementById('s-about-me')?.addEventListener('input', function(e) {
    clearTimeout(aboutTimer);
    aboutTimer = setTimeout(async function() { await sSet({ aboutMe: e.target.value }); }, 500);
  });
};

settingsSections.notifications = function(el) {
  var n = currentUser?.notifications || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navNotifications') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('desktopNotifications') + '</div><div class="settings-toggle-row-desc">' + t('desktopNotificationsDesc') + '</div></div>' + toggleHTML('s-notif-desktop', n.desktop) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('notificationSound') + '</div><div class="settings-toggle-row-desc">' + t('notificationSoundDesc') + '</div></div>' + toggleHTML('s-notif-sound', n.sound) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('messagePreview') + '</div><div class="settings-toggle-row-desc">' + t('messagePreviewDesc') + '</div></div>' + toggleHTML('s-notif-preview', n.preview) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('mentionsOnly') + '</div><div class="settings-toggle-row-desc">' + t('mentionsOnlyDesc') + '</div></div>' + toggleHTML('s-notif-mentions', n.mentionsOnly) + '</div>' +
    '</div>';

  ['s-notif-desktop', 's-notif-sound', 's-notif-preview', 's-notif-mentions'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', function(e) {
      var key = id.replace('s-notif-', '');
      var patch = { notifications: Object.assign({}, currentUser?.notifications || {}, {}) };
      patch.notifications[key] = e.target.checked;
      queueChange(patch);
    });
  });
};

settingsSections.privacy = function(el) {
  var p = currentUser?.privacy || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navPrivacy') + '</div>' +
    '<div class="settings-info-box">' + t('privacyInfo') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('allowDMs') + '</div><div class="settings-toggle-row-desc">' + t('allowDMsDesc') + '</div></div>' + toggleHTML('s-priv-dm', p.allowDM !== false) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('allowFriendReq') + '</div><div class="settings-toggle-row-desc">' + t('allowFriendReqDesc') + '</div></div>' + toggleHTML('s-priv-friendreq', p.allowFriendReq !== false) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('showActivity') + '</div><div class="settings-toggle-row-desc">' + t('showActivityDesc') + '</div></div>' + toggleHTML('s-priv-activity', p.showActivity !== false) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('showIP') + '</div><div class="settings-toggle-row-desc">' + t('showIPDesc') + '</div></div>' + toggleHTML('s-priv-ip', p.showIP) + '</div>' +
    '</div>';

  ['s-priv-dm', 's-priv-friendreq', 's-priv-activity', 's-priv-ip'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', function(e) {
      var key = id.replace('s-priv-', '');
      var patch = { privacy: Object.assign({}, currentUser?.privacy || {}, {}) };
      if (key === 'dm') patch.privacy.allowDM = e.target.checked;
      else if (key === 'friendreq') patch.privacy.allowFriendReq = e.target.checked;
      else if (key === 'activity') patch.privacy.showActivity = e.target.checked;
      else if (key === 'ip') patch.privacy.showIP = e.target.checked;
      queueChange(patch);
    });
  });
};

settingsSections.accessibility = function(el) {
  var a = currentUser?.accessibility || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navAccessibility') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('reducedMotion') + '</div><div class="settings-toggle-row-desc">' + t('reducedMotionDesc') + '</div></div>' + toggleHTML('s-acc-reducedMotion', a.reducedMotion) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('highSaturation') + '</div><div class="settings-toggle-row-desc">' + t('highSaturationDesc') + '</div></div>' + toggleHTML('s-acc-saturation', a.highSaturation) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('bigCursor') + '</div><div class="settings-toggle-row-desc">' + t('bigCursorDesc') + '</div></div>' + toggleHTML('s-acc-bigCursor', a.bigCursor) + '</div>' +
    '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('fontSize') + '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:8px">' +
        '<input type="range" class="settings-slider" id="s-acc-fontSize" min="12" max="24" value="' + (a.fontSize || 16) + '" />' +
        '<span id="s-acc-fontSize-val" style="font-size:13px;color:var(--text-muted);min-width:36px">' + (a.fontSize || 16) + 'px</span>' +
      '</div>' +
    '</div>';

  ['s-acc-reducedMotion', 's-acc-saturation', 's-acc-bigCursor'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', function(e) {
      var key = id.replace('s-acc-', '');
      var patch = { accessibility: Object.assign({}, currentUser?.accessibility || {}, {}) };
      patch.accessibility[key] = e.target.checked;
      queueChange(patch);
      applyAccessibility();
    });
  });
  document.getElementById('s-acc-fontSize')?.addEventListener('input', function(e) {
    document.getElementById('s-acc-fontSize-val').textContent = e.target.value + 'px';
  });
  document.getElementById('s-acc-fontSize')?.addEventListener('change', function(e) {
    var patch = { accessibility: Object.assign({}, currentUser?.accessibility || {}, { fontSize: parseInt(e.target.value) }) };
    patch.accessibility.fontSize = parseInt(e.target.value);
    queueChange(patch);
    applyAccessibility();
  });
};

function applyAccessibility() {
  var a = currentUser?.accessibility || {};
  document.documentElement.style.fontSize = (a.fontSize || 16) + 'px';
  document.body.classList.toggle('reduced-motion', !!a.reducedMotion);
  document.body.classList.toggle('high-saturation', !!a.highSaturation);
  document.body.classList.toggle('big-cursor', !!a.bigCursor);
}

settingsSections.language = function(el) {
  var lang = currentUser?.language || 'de';
  el.innerHTML = '<div class="settings-section-title">' + t('navLanguage') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-dropdown-row"><div><div class="settings-dropdown-row-label">' + t('displayLanguage') + '</div><div class="settings-dropdown-row-desc">' + t('displayLanguageDesc') + '</div></div>' +
      dropdownHTML('s-lang-select', [
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' }
      ], lang) + '</div>' +
    '</div>';

  document.getElementById('s-lang-select')?.addEventListener('change', async function(e) {
    await sSet({ language: e.target.value });
    try { localStorage.setItem('savedLanguage', e.target.value); } catch(ex) {}
    buildSettingsNav();
    const active = document.querySelector('.settings-nav-item.active');
    if (active) active.click();
  });
};

settingsSections.keybinds = function(el) {
  var kb = currentUser?.keybinds || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navKeybinds') + '</div>' +
    '<div class="settings-info-box">' + t('keybindsInfo') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-keybind-row"><div><div class="settings-keybind-row-label">' + t('toggleMembers') + '</div><div class="settings-keybind-row-desc">' + t('toggleMembersDesc') + '</div></div>' +
        '<button class="settings-keybind-btn" data-kb="toggleMembers">' + (kb.toggleMembers || t('ctrlKey') + '+M') + '</button></div>' +
      '<div class="settings-keybind-row"><div><div class="settings-keybind-row-label">' + t('openSettings') + '</div><div class="settings-keybind-row-desc">' + t('openSettingsDesc') + '</div></div>' +
        '<button class="settings-keybind-btn" data-kb="openSettings">' + (kb.openSettings || t('ctrlKey') + '+,') + '</button></div>' +
      '<div class="settings-keybind-row"><div><div class="settings-keybind-row-label">' + t('switchDMList') + '</div><div class="settings-keybind-row-desc">' + t('switchDMListDesc') + '</div></div>' +
        '<button class="settings-keybind-btn" data-kb="openDMs">' + (kb.openDMs || t('ctrlKey') + '+D') + '</button></div>' +
    '</div>';

  el.querySelectorAll('.settings-keybind-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.classList.contains('listening')) return;
      btn.classList.add('listening');
      btn.textContent = t('pressKey');
      function handler(e) {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('listening');
        var combo = [];
        if (e.ctrlKey) combo.push(t('ctrlKey'));
        if (e.shiftKey) combo.push('Shift');
        if (e.altKey) combo.push('Alt');
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) combo.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        var val = combo.join('+');
        btn.textContent = val;
        var patch = { keybinds: Object.assign({}, currentUser?.keybinds || {}, {}) };
        patch.keybinds[btn.dataset.kb] = val;
        queueChange(patch);
        document.removeEventListener('keydown', handler, true);
      }
      document.addEventListener('keydown', handler, true);
    });
  });
};

settingsSections.voicevideo = function(el) {
  var v = currentUser?.voice || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navVoiceVideo') + '</div>' +

    // ── Input Device ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('inputDevice') + '</div>' +
      '<select class="settings-dropdown" id="s-voice-input" style="width:100%;max-width:400px;margin-top:8px"><option value="default">' + t('loadingDevices') + '</option></select>' +
      '<div style="margin-top:12px;display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden"><div id="s-voice-meter" style="height:100%;width:0%;background:#23a55a;border-radius:3px;transition:width 0.05s"></div></div>' +
      '</div>' +
    '</div>' +

    // ── Output Device ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('outputDevice') + '</div>' +
      '<select class="settings-dropdown" id="s-voice-output" style="width:100%;max-width:400px;margin-top:8px"><option value="default">' + t('loadingDevices') + '</option></select>' +
    '</div>' +

    // ── Input Volume ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('inputVolume') + '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:8px">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text-muted);flex-shrink:0"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<input type="range" class="settings-slider" id="s-voice-inputVol" min="0" max="100" value="' + (v.inputVolume || 80) + '" style="flex:1" />' +
        '<span style="font-size:13px;color:var(--text-muted);min-width:36px">' + (v.inputVolume || 80) + '%</span>' +
      '</div>' +
    '</div>' +

    // ── Output Volume ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('outputVolume') + '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:8px">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text-muted);flex-shrink:0"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' +
        '<input type="range" class="settings-slider" id="s-voice-outputVol" min="0" max="100" value="' + (v.outputVolume || 80) + '" style="flex:1" />' +
        '<span style="font-size:13px;color:var(--text-muted);min-width:36px">' + (v.outputVolume || 80) + '%</span>' +
      '</div>' +
    '</div>' +

    // ── Mic Test ──
    '<div class="settings-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div class="settings-label" style="margin:0">' + t('micTest') + '</div>' +
        '<button class="settings-btn settings-btn-secondary" id="s-voice-mic-test" style="padding:6px 16px;font-size:13px">' + t('micTest') + '</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + t('micTestDesc') + '</div>' +
      '<div id="s-voice-mic-test-row" class="hidden" style="margin-top:12px;display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:6px;background:var(--bg-primary);border-radius:3px;overflow:hidden"><div id="s-voice-test-meter" style="height:100%;width:0%;background:#23a55a;border-radius:3px;transition:width 0.05s"></div></div>' +
      '</div>' +
    '</div>' +

    // ── Input Mode ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('inputMode') + '</div>' +
      '<div style="display:flex;gap:12px;margin-top:8px">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--text-main)">' +
          '<input type="radio" name="s-voice-mode" value="voice" ' + (v.inputMode !== 'ptt' ? 'checked' : '') + ' style="accent-color:var(--accent)" /> ' + t('voiceActivity') +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--text-main)">' +
          '<input type="radio" name="s-voice-mode" value="ptt" ' + (v.inputMode === 'ptt' ? 'checked' : '') + ' style="accent-color:var(--accent)" /> ' + t('pushToTalk') +
        '</label>' +
      '</div>' +
      '<div id="s-voice-ptt-row" class="' + (v.inputMode === 'ptt' ? '' : 'hidden') + '" style="margin-top:12px">' +
        '<div class="settings-toggle-row-label">' + t('keybindsLabel') + '</div>' +
        '<button class="settings-btn-secondary" id="s-voice-ptt-key" style="margin-top:6px;padding:6px 16px;font-size:13px">' + (v.pttKey || t('pressKey')) + '</button>' +
      '</div>' +
      '<div id="s-voice-sensitivity-row" class="' + (v.inputMode === 'ptt' ? 'hidden' : '') + '" style="margin-top:12px">' +
        '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('autoSensitivity') + '</div><div class="settings-toggle-row-desc">' + t('autoSensitivityDesc') + '</div></div>' +
          toggleHTML('s-voice-auto-sens', v.autoSensitivity !== false) + '</div>' +
        '<div id="s-voice-sensitivity-slider" class="' + (v.autoSensitivity === false ? '' : 'hidden') + '" style="margin-top:8px;display:flex;align-items:center;gap:12px">' +
          '<input type="range" class="settings-slider" id="s-voice-threshold" min="0" max="100" value="' + (v.sensitivity || 50) + '" style="flex:1" />' +
          '<span style="font-size:13px;color:var(--text-muted);min-width:36px">' + (v.sensitivity || 50) + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ── Camera ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('cameraDevice') + '</div>' +
      '<select class="settings-dropdown" id="s-voice-camera" style="width:100%;max-width:400px;margin-top:8px"><option value="none">' + t('noCamera') + '</option></select>' +
      '<div style="margin-top:12px;border-radius:8px;overflow:hidden;background:#000;max-width:480px;aspect-ratio:16/9;position:relative">' +
        '<video id="s-voice-cam-preview" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:block"></video>' +
        '<div id="s-voice-cam-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:14px">' + t('noCamera') + '</div>' +
      '</div>' +
    '</div>' +

    // ── Video Configuration ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('videoConfig') + '</div>' +
      '<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px">' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + t('resolution') + '</div>' +
          '<select class="settings-dropdown" id="s-voice-resolution" style="width:100%">' +
            '<option value="480p"' + ((v.resolution || '720p') === '480p' ? ' selected' : '') + '>480p</option>' +
            '<option value="720p"' + ((v.resolution || '720p') === '720p' ? ' selected' : '') + '>720p</option>' +
            '<option value="1080p"' + ((v.resolution || '720p') === '1080p' ? ' selected' : '') + '>1080p</option>' +
          '</select>' +
        '</div>' +
        '<div style="flex:1;min-width:180px">' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + t('frameRate') + '</div>' +
          '<select class="settings-dropdown" id="s-voice-fps" style="width:100%">' +
            '<option value="15"' + ((v.fps || '30') === '15' ? ' selected' : '') + '>15 FPS</option>' +
            '<option value="30"' + ((v.fps || '30') === '30' ? ' selected' : '') + '>30 FPS</option>' +
            '<option value="60"' + ((v.fps || '30') === '60' ? ' selected' : '') + '>60 FPS</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ── Advanced Settings ──
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('advancedSettings') + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('echoReduction') + '</div><div class="settings-toggle-row-desc">' + t('echoReductionDesc') + '</div></div>' + toggleHTML('s-voice-echo', v.echo) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('noiseReduction') + '</div><div class="settings-toggle-row-desc">' + t('noiseReductionDesc') + '</div></div>' + toggleHTML('s-voice-noise', v.noise) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('gainControl') + '</div><div class="settings-toggle-row-desc">' + t('gainControlDesc') + '</div></div>' + toggleHTML('s-voice-gain', v.gain) + '</div>' +
    '</div>';

  // ── Enumerate devices ──
  function populateDevices(devices) {
    var inputSel = document.getElementById('s-voice-input');
    var outputSel = document.getElementById('s-voice-output');
    var cameraSel = document.getElementById('s-voice-camera');
    if (inputSel) {
      inputSel.innerHTML = '<option value="default">' + t('defaultMicrophone') + '</option>';
      devices.filter(function(d) { return d.kind === 'audioinput'; }).forEach(function(d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || (t('microphone') + ' ' + d.deviceId.substring(0, 8));
        if (v.inputDevice === d.deviceId) opt.selected = true;
        inputSel.appendChild(opt);
      });
    }
    if (outputSel) {
      outputSel.innerHTML = '<option value="default">' + t('defaultSpeaker') + '</option>';
      devices.filter(function(d) { return d.kind === 'audiooutput'; }).forEach(function(d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || (t('speaker') + ' ' + d.deviceId.substring(0, 8));
        if (v.outputDevice === d.deviceId) opt.selected = true;
        outputSel.appendChild(opt);
      });
    }
    if (cameraSel) {
      var cams = devices.filter(function(d) { return d.kind === 'videoinput'; });
      cameraSel.innerHTML = '<option value="none">' + t('noCamera') + '</option>';
      cams.forEach(function(d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || (t('cameraDevice') + ' ' + d.deviceId.substring(0, 8));
        if (v.cameraDevice === d.deviceId) opt.selected = true;
        cameraSel.appendChild(opt);
      });
    }
  }

  async function enumerateDevices() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(function(t) { t.stop(); });
    } catch(e) {}
    try {
      var stream2 = await navigator.mediaDevices.getUserMedia({ video: true });
      stream2.getTracks().forEach(function(t) { t.stop(); });
    } catch(e) {}
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      populateDevices(devices);
    } catch(e) {}
  }

  enumerateDevices();

  // ── Live input meter ──
  var _meterStream = null;
  var _meterInterval = null;
  var _meterCtx = null;
  var _meterAnalyser = null;

  function startInputMeter() {
    var deviceId = v.inputDevice || 'default';
    var constraints = { audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } };
    navigator.mediaDevices?.getUserMedia(constraints).then(function(stream) {
      _meterStream = stream;
      _meterCtx = new (window.AudioContext || window.webkitAudioContext)();
      var source = _meterCtx.createMediaStreamSource(stream);
      _meterAnalyser = _meterCtx.createAnalyser();
      _meterAnalyser.fftSize = 256;
      source.connect(_meterAnalyser);
      var data = new Uint8Array(_meterAnalyser.frequencyBinCount);
      var meter = document.getElementById('s-voice-meter');
      _meterInterval = setInterval(function() {
        if (!_meterAnalyser || !meter) return;
        _meterAnalyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var pct = Math.min(100, Math.round(avg / 128 * 100));
        meter.style.width = pct + '%';
        meter.style.background = pct > 80 ? '#f23f43' : pct > 50 ? '#f0b232' : '#23a55a';
      }, 50);
    }).catch(function() {});
  }

  function stopInputMeter() {
    if (_meterInterval) { clearInterval(_meterInterval); _meterInterval = null; }
    if (_meterStream) { _meterStream.getTracks().forEach(function(t) { t.stop(); }); _meterStream = null; }
    if (_meterCtx) { try { _meterCtx.close(); } catch(e) {} _meterCtx = null; _meterAnalyser = null; }
    var meter = document.getElementById('s-voice-meter');
    if (meter) meter.style.width = '0%';
  }

  startInputMeter();

  // ── Mic test (Discord-style: man hoert sich selbst) ──
  var _testActive = false;
  var _testStream = null;
  var _testInterval = null;
  var _testCtx = null;
  var _testGainNode = null;
  document.getElementById('s-voice-mic-test')?.addEventListener('click', async function() {
    var btn = this;
    var row = document.getElementById('s-voice-mic-test-row');
    if (_testActive) {
      _testActive = false;
      btn.textContent = t('micTest');
      if (row) row.classList.add('hidden');
      if (_testInterval) { clearInterval(_testInterval); _testInterval = null; }
      if (_testStream) { _testStream.getTracks().forEach(function(t) { t.stop(); }); _testStream = null; }
      if (_testCtx) { try { _testCtx.close(); } catch(e) {} _testCtx = null; _testGainNode = null; }
      return;
    }
    try {
      var deviceId = v.inputDevice || 'default';
      var constraints = { audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } };
      _testStream = await navigator.mediaDevices.getUserMedia(constraints);
      _testActive = true;
      btn.textContent = t('micTestStop');
      if (row) row.classList.remove('hidden');
      _testCtx = new (window.AudioContext || window.webkitAudioContext)();
      var source = _testCtx.createMediaStreamSource(_testStream);

      // Analyser fuer den visuellen Meter
      var analyser = _testCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // Gain-Node fuer Lautstaerke-Steuerung des Loopback
      _testGainNode = _testCtx.createGain();
      var vol = (v.outputVolume || 80) / 100;
      _testGainNode.gain.value = vol;
      source.connect(_testGainNode);
      _testGainNode.connect(_testCtx.destination);

      var data = new Uint8Array(analyser.frequencyBinCount);
      var meter = document.getElementById('s-voice-test-meter');
      _testInterval = setInterval(function() {
        if (!analyser || !meter) return;
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var pct = Math.min(100, Math.round(avg / 128 * 100));
        meter.style.width = pct + '%';
        meter.style.background = pct > 80 ? '#f23f43' : pct > 50 ? '#f0b232' : '#23a55a';
      }, 50);
    } catch(e) {
      _testActive = false;
    }
  });

  // ── Camera preview ──
  var _camStream = null;

  function startCameraPreview(deviceId) {
    stopCameraPreview();
    var preview = document.getElementById('s-voice-cam-preview');
    var placeholder = document.getElementById('s-voice-cam-placeholder');
    if (!deviceId || deviceId === 'none') {
      if (preview) preview.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
      return;
    }
    navigator.mediaDevices?.getUserMedia({ video: { deviceId: { exact: deviceId } } }).then(function(stream) {
      _camStream = stream;
      if (preview) { preview.srcObject = stream; preview.style.display = 'block'; }
      if (placeholder) placeholder.style.display = 'none';
    }).catch(function() {
      if (preview) preview.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    });
  }

  function stopCameraPreview() {
    if (_camStream) { _camStream.getTracks().forEach(function(t) { t.stop(); }); _camStream = null; }
    var preview = document.getElementById('s-voice-cam-preview');
    if (preview) { preview.srcObject = null; preview.style.display = 'none'; }
  }

  if (v.cameraDevice && v.cameraDevice !== 'none') {
    startCameraPreview(v.cameraDevice);
  } else {
    var preview = document.getElementById('s-voice-cam-preview');
    var placeholder = document.getElementById('s-voice-cam-placeholder');
    if (preview) preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }

  // ── Event Listeners ──
  document.getElementById('s-voice-input')?.addEventListener('change', function(e) {
    v.inputDevice = e.target.value;
    queueChange({ voice: v });
    stopInputMeter();
    setTimeout(startInputMeter, 200);
  });
  document.getElementById('s-voice-output')?.addEventListener('change', function(e) {
    v.outputDevice = e.target.value;
    queueChange({ voice: v });
  });
  document.getElementById('s-voice-inputVol')?.addEventListener('input', function(e) { e.target.nextElementSibling.textContent = e.target.value + '%'; });
  document.getElementById('s-voice-inputVol')?.addEventListener('change', function(e) {
    v.inputVolume = parseInt(e.target.value);
    queueChange({ voice: v });
  });
  document.getElementById('s-voice-outputVol')?.addEventListener('input', function(e) {
    e.target.nextElementSibling.textContent = e.target.value + '%';
    if (_testGainNode) _testGainNode.gain.value = parseInt(e.target.value) / 100;
  });
  document.getElementById('s-voice-outputVol')?.addEventListener('change', function(e) {
    v.outputVolume = parseInt(e.target.value);
    queueChange({ voice: v });
  });
  document.getElementById('s-voice-camera')?.addEventListener('change', function(e) {
    v.cameraDevice = e.target.value;
    queueChange({ voice: v });
    startCameraPreview(e.target.value);
  });
  document.getElementById('s-voice-resolution')?.addEventListener('change', function(e) {
    v.resolution = e.target.value;
    queueChange({ voice: v });
  });
  document.getElementById('s-voice-fps')?.addEventListener('change', function(e) {
    v.fps = e.target.value;
    queueChange({ voice: v });
  });
  document.querySelectorAll('input[name="s-voice-mode"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      v.inputMode = e.target.value;
      queueChange({ voice: v });
      document.getElementById('s-voice-ptt-row')?.classList.toggle('hidden', e.target.value !== 'ptt');
      document.getElementById('s-voice-sensitivity-row')?.classList.toggle('hidden', e.target.value === 'ptt');
    });
  });
  document.getElementById('s-voice-ptt-key')?.addEventListener('click', function() {
    var btn = this;
    btn.textContent = '...';
    function handler(e) {
      e.preventDefault();
      v.pttKey = e.key;
      btn.textContent = e.key;
      queueChange({ voice: v });
      document.removeEventListener('keydown', handler);
    }
    document.addEventListener('keydown', handler);
  });
  document.getElementById('s-voice-auto-sens')?.addEventListener('change', function(e) {
    v.autoSensitivity = e.target.checked;
    queueChange({ voice: v });
    document.getElementById('s-voice-sensitivity-slider')?.classList.toggle('hidden', e.target.checked);
  });
  document.getElementById('s-voice-threshold')?.addEventListener('input', function(e) { e.target.nextElementSibling.textContent = e.target.value + '%'; });
  document.getElementById('s-voice-threshold')?.addEventListener('change', function(e) {
    v.sensitivity = parseInt(e.target.value);
    queueChange({ voice: v });
  });
  ['s-voice-echo', 's-voice-noise', 's-voice-gain'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', function(e) {
      var key = id.replace('s-voice-', '');
      v[key] = e.target.checked;
      queueChange({ voice: v });
    });
  });

  // ── Cleanup on section change ──
  var _observer = new MutationObserver(function() {
    if (el.closest('.hidden') || !el.isConnected) {
      stopInputMeter();
      stopCameraPreview();
      if (_testActive) {
        _testActive = false;
        if (_testInterval) { clearInterval(_testInterval); _testInterval = null; }
        if (_testStream) { _testStream.getTracks().forEach(function(t) { t.stop(); }); _testStream = null; }
        if (_testCtx) { try { _testCtx.close(); } catch(e) {} _testCtx = null; }
      }
      _observer.disconnect();
    }
  });
  _observer.observe(el.parentElement || el, { attributes: true, subtree: true, attributeFilter: ['class'] });
};

settingsSections.appearance = function(el) {
  var theme = _pendingChanges.theme !== undefined ? _pendingChanges.theme : (currentUser?.theme || 'dark');
  var bgPath = _pendingChanges.backgroundPath !== undefined ? _pendingChanges.backgroundPath : (currentUser?.backgroundPath || '');
  var bgKind = _pendingChanges.backgroundKind !== undefined ? _pendingChanges.backgroundKind : (currentUser?.backgroundKind || '');
  var bgSound = _pendingChanges.backgroundSound !== undefined ? _pendingChanges.backgroundSound : (currentUser?.backgroundSound || false);
  var bgBlur = _pendingChanges.backgroundBlur !== undefined ? _pendingChanges.backgroundBlur : (currentUser?.backgroundBlur || 0);
  el.innerHTML = '<div class="settings-section-title">' + t('navAppearance') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('theme') + '</div>' +
      '<div class="theme-row" style="margin-top:8px">' +
        '<div class="theme-btn' + (theme === 'dark' ? ' active-theme' : '') + '" data-theme="dark" style="padding:20px 8px;text-align:center">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:#313338;margin:0 auto 8px;border:2px solid ' + (theme === 'dark' ? 'var(--accent)' : 'transparent') + '"></div>Dark</div>' +
        '<div class="theme-btn' + (theme === 'light' ? ' active-theme' : '') + '" data-theme="light" style="padding:20px 8px;text-align:center">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:#fff;margin:0 auto 8px;border:2px solid ' + (theme === 'light' ? 'var(--accent)' : 'var(--border)') + '"></div>Light</div>' +
        '<div class="theme-btn' + (theme === 'midnight' ? ' active-theme' : '') + '" data-theme="midnight" style="padding:20px 8px;text-align:center">' +
          '<div style="width:32px;height:32px;border-radius:50%;background:#10121e;margin:0 auto 8px;border:2px solid ' + (theme === 'midnight' ? 'var(--accent)' : 'transparent') + '"></div>Midnight</div>' +
      '</div>' +
    '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-label">' + t('background') + '</div>' +
      '<div style="height:100px;border-radius:8px;background:' + (bgPath ? 'url("' + toFileUrl(bgPath) + '") center/cover' : 'var(--bg-input)') + ';display:flex;align-items:center;justify-content:center;margin-bottom:10px;color:var(--text-muted);font-size:13px">' +
        (bgPath ? '' : t('noBackground')) +
      '</div>' +
      '<div class="bg-row">' +
        '<button id="s-pick-bg">' + t('uploadBackground') + '</button>' +
        '<button class="secondary" id="s-clear-bg">' + t('removeBackground') + '</button>' +
      '</div>' +
      '<div id="s-bg-sound-row" class="' + (bgKind === 'video' ? '' : 'hidden') + '">' +
        '<label class="bg-sound-label"><input type="checkbox" id="s-bg-sound-toggle" ' + (bgSound ? 'checked' : '') + ' /> ' + t('playSound') + '</label>' +
      '</div>' +
      (bgPath ?
      '<div style="margin-top:12px">' +
        '<div class="settings-label">' + t('blurAmount') + '</div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-top:8px">' +
          '<input type="range" class="settings-slider" id="s-bg-blur" min="0" max="20" value="' + bgBlur + '" style="flex:1" />' +
          '<span id="s-bg-blur-val" style="font-size:13px;color:var(--text-muted);min-width:36px;text-align:right">' + bgBlur + 'px</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:4px"><span>' + t('blurSharp') + '</span><span>' + t('blurBlurred') + '</span></div>' +
      '</div>' : '') +
    '</div>';

  el.querySelectorAll('.theme-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      queueChange({ theme: btn.dataset.theme });
      applyProfileToUI();
      renderSettingsSection('appearance');
    });
  });

  document.getElementById('s-pick-bg')?.addEventListener('click', async function() {
    var r = await window.api.pickBackground();
    if (r?.ok) { queueChange({ backgroundPath: r.path, backgroundKind: r.kind, backgroundSound: false }); applyBackground(); renderSettingsSection('appearance'); }
    else if (r?.error) { alert(r.error); }
  });
  document.getElementById('s-clear-bg')?.addEventListener('click', function() {
    queueChange({ backgroundPath: null, backgroundKind: null, backgroundSound: false }); applyBackground(); renderSettingsSection('appearance');
  });
  document.getElementById('s-bg-sound-toggle')?.addEventListener('change', function(e) {
    queueChange({ backgroundSound: e.target.checked });
    var v = document.getElementById('bg-video'); if (v) v.muted = !e.target.checked;
  });
  var blurSlider = document.getElementById('s-bg-blur');
  if (blurSlider) {
    blurSlider.addEventListener('input', function(e) {
      document.getElementById('s-bg-blur-val').textContent = e.target.value + 'px';
      applyBackgroundBlur(parseInt(e.target.value));
    });
    blurSlider.addEventListener('change', function(e) {
      queueChange({ backgroundBlur: parseInt(e.target.value) });
    });
  }
};

settingsSections.advanced = function(el) {
  var adv = currentUser?.advanced || {};
  el.innerHTML = '<div class="settings-section-title">' + t('navAdvanced') + '</div>' +
    '<div class="settings-info-box">' + t('advancedInfoDesc') + '</div>' +
    '<div class="settings-card">' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('devMode') + '</div><div class="settings-toggle-row-desc">' + t('devModeDesc') + '</div></div>' + toggleHTML('s-adv-devMode', adv.devMode) + '</div>' +
      '<div class="settings-toggle-row"><div><div class="settings-toggle-row-label">' + t('debugConsole') + '</div><div class="settings-toggle-row-desc">' + t('debugConsoleDesc') + '</div></div>' + toggleHTML('s-adv-debugConsole', adv.debugConsole) + '</div>' +
    '</div>';

  ['s-adv-devMode', 's-adv-debugConsole'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('change', function(e) {
      var key = id.replace('s-adv-', '');
      var patch = { advanced: Object.assign({}, currentUser?.advanced || {}, {}) };
      patch.advanced[key] = e.target.checked;
      queueChange(patch);
    });
  });
};

settingsSections.reset = function(el) {
  el.innerHTML = '<div class="settings-section-title">' + t('navReset') + '</div>' +
    '<div class="settings-info-box">' + t('resetInfo') + '</div>' +
    '<div class="settings-danger-zone">' +
      '<div class="settings-danger-zone-title">' + t('resetBtn') + '</div>' +
      '<div class="settings-danger-zone-desc">' + t('resetDanger') + '</div>' +
      '<button class="settings-btn-danger" id="s-reset-all">' + t('resetBtn') + '</button>' +
    '</div>';

  document.getElementById('s-reset-all')?.addEventListener('click', async function() {
    if (!confirm(t('resetConfirm'))) return;
    await sSet({
      notifications: {},
      privacy: {},
      accessibility: {},
      language: 'de',
      keybinds: {},
      voice: {},
      advanced: {},
      theme: 'dark',
      backgroundPath: null,
      backgroundKind: null,
      backgroundSound: false,
      accentColor: '#5865f2'
    });
    applyProfileToUI();
    applyAccessibility();
    renderSettingsSection('reset');
  });
};

settingsSections.admin = function(el) {
  if (localStorage.getItem('adminAuth')) {
    el.innerHTML = '<div class="settings-section-title">' + t('navAdminPanel') + '</div><div id="settings-admin-container"></div>';
    loadAdminUsersInto(document.getElementById('settings-admin-container'));
  } else {
    el.innerHTML = '<div class="settings-section-title">' + t('navAdminPanel') + '</div>' +
      '<div class="settings-info-box">' + t('adminEnterPassword') + '</div>' +
      '<input type="password" class="settings-input" id="settings-admin-pw" placeholder="' + t('adminPassword') + '" />' +
      '<p class="error" id="settings-admin-error"></p>' +
      '<button class="settings-btn settings-btn-primary" id="settings-admin-login-btn">' + t('login') + '</button>';
    document.getElementById('settings-admin-login-btn')?.addEventListener('click', async function() {
      var pw = document.getElementById('settings-admin-pw')?.value;
      var errEl = document.getElementById('settings-admin-error');
      if (errEl) errEl.textContent = '';
      var result = await window.api.adminLogin(pw);
      if (!result?.ok) { if (errEl) errEl.textContent = result?.error || t('error'); return; }
      if (result.firstTime) await window.api.adminSetPassword(pw);
      localStorage.setItem('adminAuth', '1');
      settingsSections.admin(el);
    });
  }
};

settingsSections.switchuser = function(el) {
  el.innerHTML = '<div class="settings-section-title">' + t('switchUser') + '</div>' +
    '<div class="settings-info-box">' + t('switchUserInfo') + '</div>' +
    '<button class="settings-btn" id="s-switchuser-btn">' + t('switchUserLogin') + '</button>';

  document.getElementById('s-switchuser-btn')?.addEventListener('click', function() {
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('adminAuth');
    window.location.href = 'login.html';
  });
};

function switchToUser(targetUserId) {
  if (targetUserId) {
    localStorage.setItem('currentUserId', targetUserId);
  } else {
    localStorage.removeItem('currentUserId');
  }
  localStorage.removeItem('adminAuth');
  window.location.href = 'login.html';
}

settingsSections.logout = function(el) {
  el.innerHTML = '<div class="settings-section-title">' + t('navLogout') + '</div>' +
    '<div class="settings-info-box">' + t('logoutInfo') + '</div>' +
    '<div class="settings-danger-zone">' +
      '<div class="settings-danger-zone-title">' + t('navLogout') + '</div>' +
      '<div class="settings-danger-zone-desc">' + t('logoutConfirm') + '</div>' +
      '<button class="settings-btn-danger" id="s-logout-btn">' + t('navLogout') + '</button>' +
    '</div>';

  document.getElementById('s-logout-btn')?.addEventListener('click', function() {
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('adminAuth');
    window.location.href = 'login.html';
  });
};

async function loadAdminUsersInto(container) {
  if (!container) return;
  var users = (await window.api.adminGetAllUsers()) || [];
  container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">' + users.length + ' ' + t('usersRegistered') + '</div>' +
    '<div class="admin-user-list" id="admin-user-list-settings"></div>';
  var list = document.getElementById('admin-user-list-settings');
  if (list) users.forEach(function(u) { renderAdminUserCard(list, u); });
}

// ── Settings: Legacy Event Listeners (kept for backward compatibility) ──
document.getElementById('pick-avatar')?.addEventListener('click', async () => {
  var result = await window.api.pickImage('avatar');
  if (!result?.ok) return;
  await sSet({ avatarPath: result.path });
  applyProfileToUI();
});
document.getElementById('pick-banner')?.addEventListener('click', async () => {
  var result = await window.api.pickImage('banner');
  if (!result?.ok) return;
  await sSet({ bannerPath: result.path, bannerType: result.isGif ? 'gif' : 'image' });
  applyProfileToUI();
});
let aboutMeTimer = null;
document.getElementById('about-me')?.addEventListener('input', (e) => {
  clearTimeout(aboutMeTimer);
  aboutMeTimer = setTimeout(async () => { await sSet({ aboutMe: e.target.value }); }, 500);
});
document.getElementById('pick-background')?.addEventListener('click', async () => {
  var result = await window.api.pickBackground();
  if (!result?.ok) return;
  await sSet({ backgroundPath: result.path, backgroundKind: result.kind, backgroundSound: false });
  applyBackground();
});
document.getElementById('clear-background')?.addEventListener('click', async () => {
  await sSet({ backgroundPath: null, backgroundKind: null, backgroundSound: false });
  applyBackground();
});
document.getElementById('bg-sound-toggle')?.addEventListener('change', async (e) => {
  await sSet({ backgroundSound: e.target.checked });
  var v = document.getElementById('bg-video'); if (v) v.muted = !e.target.checked;
});
document.querySelectorAll('.theme-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await sSet({ theme: btn.dataset.theme });
    applyProfileToUI();
  });
});

// ── Event Delegation: Messages ──
document.getElementById('messages')?.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('.msg-action-btn');
  if (actionBtn) {
    const msgEl = actionBtn.closest('.msg');
    if (!msgEl) return;
    const msgId = msgEl.dataset.msgId;
    const action = actionBtn.dataset.action;
    const contentEl = document.getElementById('msg-content-' + msgId);
    const content = contentEl?.textContent || '';
    if (action === 'copy') {
      await navigator.clipboard.writeText(content).catch(() => {});
    } else if (action === 'react') {
      showEmojiPicker(msgId, actionBtn);
    } else if (action === 'edit') {
      startEditMessage(msgId, content);
    } else if (action === 'delete') {
      if (confirm(t('confirmDeleteMessage'))) {
        await window.api.messagesDelete(msgId);
        if (currentView === 'dm' && currentDM) await loadDMMessages();
        else if (currentChannel) await loadMessages();
      }
    }
    return;
  }
  const reactionEl = e.target.closest('.msg-reaction');
  if (reactionEl) {
    await window.api.messagesReact(reactionEl.dataset.msgid, reactionEl.dataset.emoji, userId);
    if (currentView === 'dm' && currentDM) await loadDMMessages();
    else if (currentChannel) await loadMessages();
    return;
  }
  const authorEl = e.target.closest('.author');
  if (authorEl) {
    const authorId = authorEl.dataset.authorId;
    if (authorId) showProfilePopup(authorId);
    return;
  }
  const avatarEl = e.target.closest('.msg-avatar');
  if (avatarEl) {
    const authorId = avatarEl.dataset.authorId;
    if (authorId) showProfilePopup(authorId);
    return;
  }
  const dlBtn = e.target.closest('.att-dl-btn');
  if (dlBtn) {
    e.stopPropagation();
    if (dlBtn.classList.contains('att-dl-fullscreen')) {
      openLightbox(dlBtn.dataset.dlUrl, dlBtn.dataset.dlName, 'video');
    } else if (window.api?.downloadFile) {
      window.api.downloadFile(dlBtn.dataset.dlUrl, dlBtn.dataset.dlName);
    }
    return;
  }
  const imgAtt = e.target.closest('.msg-att-image');
  if (imgAtt) {
    openLightbox(imgAtt.dataset.attUrl, imgAtt.dataset.attName, 'image');
    return;
  }
});

document.getElementById('messages')?.addEventListener('contextmenu', (e) => {
  const msgEl = e.target.closest('.msg');
  if (msgEl) showContextMenu(e, msgEl);
});

document.addEventListener('click', () => {
  document.getElementById('context-menu')?.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'status-dot' || e.target.closest('#status-dot')) {
    showStatusSelector();
  }
});

// ── Members toggle ──
document.getElementById('toggle-members')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMembersSidebar();
  closeMobileMenu();
});

// ── ESC key closes overlays ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('settings-overlay')?.classList.add('hidden');
    document.getElementById('admin-overlay')?.classList.add('hidden');
    document.getElementById('create-server-overlay')?.classList.add('hidden');
    document.getElementById('dm-new-overlay')?.classList.add('hidden');
    document.getElementById('server-settings-overlay')?.classList.add('hidden');
    document.getElementById('context-menu')?.classList.add('hidden');
    document.getElementById('profile-popup-overlay')?.classList.add('hidden');
    document.getElementById('status-selector')?.classList.add('hidden');
  }
});

// ── Search ──
document.getElementById('search-btn')?.addEventListener('click', function () {
  var bar = document.getElementById('search-bar');
  var input = document.getElementById('search-input');
  if (bar) {
    var visible = bar.style.display !== 'none';
    bar.style.display = visible ? 'none' : 'flex';
    if (!visible && input) input.focus();
    if (visible) {
      if (input) input.value = '';
      if (currentChannel) loadMessages();
    }
  }
});

document.getElementById('search-close')?.addEventListener('click', function () {
  var bar = document.getElementById('search-bar');
  var input = document.getElementById('search-input');
  if (bar) bar.style.display = 'none';
  if (input) input.value = '';
  if (currentChannel) loadMessages();
});

let searchTimer = null;
document.getElementById('search-input')?.addEventListener('input', function () {
  clearTimeout(searchTimer);
  const query = this.value.trim();
  if (!query || query.length < 2) {
    if (currentChannel) loadMessages();
    return;
  }
  searchTimer = setTimeout(async () => {
    const results = await window.api.messagesSearch(query, null, currentServer?.id || null);
    if (!results) return;
    renderSearchResults(results, query);
  }, 300);
});

function renderSearchResults(msgs, query) {
  const list = document.getElementById('messages');
  if (!list) return;
  list.innerHTML = '';
  if (msgs.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><p>Keine Ergebnisse für "' + escHtml(query) + '"</p></div>';
    return;
  }
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;font-size:13px;color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.06)';
  header.textContent = msgs.length + ' Ergebnis(se) für "' + query + '"';
  list.appendChild(header);
  msgs.forEach(function (m) {
    const authorName = getAuthorNameSync(m.authorId);
    const date = new Date(m.timestamp);
    const timeStr = date.toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'msg';
    div.style.cursor = 'pointer';
    const highlighted = (m.content || '').replace(new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark style="background:rgba(250,166,26,0.3);color:inherit;border-radius:2px">$1</mark>');
    div.innerHTML = '<div class="msg-body"><div class="msg-header"><span class="author">' + escHtml(authorName) + '</span><span class="msg-timestamp">' + timeStr + '</span></div><div class="msg-content">' + highlighted + '</div></div>';
    div.addEventListener('click', async function () {
      if (m.channelId) {
        var foundChannel = currentServer?.channels?.find(function (c) { return c.id === m.channelId; });
        if (foundChannel) {
          document.getElementById('search-bar').style.display = 'none';
          document.getElementById('search-input').value = '';
          await selectChannel(foundChannel);
          setTimeout(function () {
            var msgEl = document.querySelector('[data-msg-id="' + m.id + '"]');
            if (msgEl) {
              msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              msgEl.style.background = 'rgba(250,166,26,0.15)';
              setTimeout(function () { msgEl.style.background = ''; }, 2000);
            }
          }, 200);
        }
      }
    });
    list.appendChild(div);
  });
}

// ── Init ──
loadProfile().then(async () => {
  ensureMembersSidebar();
  ensureContextMenu();
  ensureProfilePopup();
  ensureStatusDot();
  ensureMembersToggle();
  await loadServers();
  document.getElementById('home-btn')?.click();
  setInterval(pollForNewDMs, 5000);
  setInterval(pollForChannelMessages, 3000);
  setInterval(pollForActiveDM, 3000);
  if (window.KryoCalls) window.KryoCalls.connectSocket();
}).catch(function(err) { console.error('[Init]', err); });

async function pollForChannelMessages() {
  try {
    if (currentView !== 'server' || !currentChannel) return;
    var msgs = (await window.api.messagesGet(currentChannel.id)) || [];
    var prevCount = lastChannelMsgCount[currentChannel.id] || 0;
    lastChannelMsgCount[currentChannel.id] = msgs.length;
    if (msgs.length !== prevCount && prevCount > 0) {
      renderMessages(msgs);
      var list = document.getElementById('messages');
      if (list) list.scrollTop = list.scrollHeight;
    }
  } catch(e) {}
}

async function pollForActiveDM() {
  try {
    if (currentView !== 'dm' || !currentDM) return;
    var msgs = (await window.api.dmGetMessages(currentDM.id)) || [];
    var prevDMCount = lastDMPollCount || 0;
    lastDMPollCount = msgs.length;
    if (msgs.length !== prevDMCount && prevDMCount > 0) {
      await renderDMMessages(msgs);
      scrollMessagesToBottom();
    }
  } catch(e) {}
}

async function pollForNewDMs() {
  try {
    var dms = (await window.api.dmGetAll(userId)) || [];
    for (var dm of dms) {
      var msgs = dm.messages || [];
      var lastMsg = msgs[msgs.length - 1];
      var lastSeen = lastSeenTimestamps[dm.id] || 0;
      if (lastMsg && lastMsg.authorId !== userId && lastMsg.timestamp > lastSeen && currentDM?.id !== dm.id) {
        if (!unreadDMs[dm.id]) {
          unreadDMs[dm.id] = true;
          if (lastSeen > 0) {
            var otherId = dm.participants?.find(function(p) { return p !== userId; });
            var otherName = otherId ? await getAuthorName(otherId) : t('somebody');
            var otherUser = otherId ? await window.api.getUserById(otherId) : null;
            var avSrc = (otherUser?.ok && otherUser.user?.avatarPath) ? toFileUrl(otherUser.user.avatarPath) : defaultAvatar(otherName[0] || '?');
            playDMNotification();
            showToast(otherName, lastMsg.content || t('newMessage'), avSrc);
          }
          lastSeenTimestamps[dm.id] = lastMsg.timestamp;
        }
      }
    }
    if (currentView === 'dms') updateDMBadge();
  } catch(e) {}
}

// ── Mobile Menu Toggle ──
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const layoutEl = document.querySelector('.layout');

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    layoutEl.classList.toggle('menu-open');
  });
}

// Close mobile menu when tapping on chat-area (outside drawer)
document.querySelector('.chat-area')?.addEventListener('click', function() {
  if (layoutEl.classList.contains('menu-open')) {
    layoutEl.classList.remove('menu-open');
  }
});

// Close mobile menu on channel/server click
function closeMobileMenu() {
  if (layoutEl) layoutEl.classList.remove('menu-open');
}
