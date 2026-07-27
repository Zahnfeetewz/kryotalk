import { GhostIdentity, SignalSession, SignalX3DH, generateQR } from './crypto.js';

let myIdentity = null;
let ws = null;
let contacts = {};
let sessions = {};
let currentChat = null;
let ephemeralMode = false;
const pendingFetches = new Map();
const pendingMessages = new Map();

function $(id) { return document.getElementById(id); }
function store(key, val) { localStorage.setItem('ghost_' + key, JSON.stringify(val)); }
function load(key) { const d = localStorage.getItem('ghost_' + key); return d ? JSON.parse(d) : null; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function getContactName(id) {
  if (!contacts[id]) return id.substring(0, 8) + '...';
  return contacts[id].name || id.substring(0, 8) + '...';
}

function waitForResponse(msgType, userId, timeout = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingFetches.delete(key); resolve(null); }, timeout);
    const key = msgType + ':' + userId;
    pendingFetches.set(key, (data) => { clearTimeout(timer); pendingFetches.delete(key); resolve(data); });
  });
}

function sendWS(data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function connectWS() {
  if (ws && ws.readyState <= 1) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host);

  ws.onopen = () => {
    sendWS({ type: 'identify', userId: myIdentity.identityId, identityPackage: GhostIdentity.getIdentityPackage(myIdentity) });
  };

  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'identified') {
      renderConversations();
      return;
    }

    if (msg.type === 'identity_response') {
      const key = 'fetch_identity:' + msg.userId;
      const cb = pendingFetches.get(key);
      if (cb) { pendingFetches.delete(key); cb(msg.identityPackage); }
      return;
    }

    if (msg.type === 'session_init' && msg.from && msg.ephemeralPublicKey) {
      if (!sessions[msg.from]) {
        try {
          const result = await SignalX3DH.performAsResponder(myIdentity, msg.ephemeralPublicKey, msg.identityPublicKey);
          sessions[msg.from] = result.session;
          store('sessions', sessions);
          console.log('Session established with', msg.from);
          const buffered = pendingMessages.get(msg.from) || [];
          pendingMessages.delete(msg.from);
          for (const bufferedMsg of buffered) {
            await processIncomingMessage(bufferedMsg);
          }
        } catch (e) {
          console.error('Session init as responder failed:', e);
        }
      }
      return;
    }

    if (msg.type === 'message' && msg.from) {
      if (!sessions[msg.from]) {
        console.log('No session yet for', msg.from, '- buffering message');
        if (!pendingMessages.has(msg.from)) pendingMessages.set(msg.from, []);
        pendingMessages.get(msg.from).push(msg);
        return;
      }
      await processIncomingMessage(msg);
      return;
    }

    if (msg.type === 'delivery_receipt') return;
    if (msg.type === 'pong') return;
  };

  ws.onclose = () => { setTimeout(connectWS, 3000); };
  setInterval(() => sendWS({ type: 'ping' }), 25000);
}

async function ensureSession(contactId) {
  if (sessions[contactId]) return true;
  const contact = contacts[contactId];
  if (!contact || !contact.identityPackage) return false;

  try {
    let pkg = typeof contact.identityPackage === 'string' ? JSON.parse(contact.identityPackage) : contact.identityPackage;
    if (!pkg.spk || !pkg.ik) throw new Error('Ungültiges Paket');
    const result = SignalX3DH.performAsInitiator(myIdentity, pkg);
    sessions[contactId] = result.session;
    store('sessions', sessions);
    sendWS({ type: 'session_init', to: contactId, ephemeralPublicKey: result.ephemeralPublicKey, identityPublicKey: myIdentity.identityKeyPublic });
    return true;
  } catch (e) {
    console.error('Session init failed:', e);
    return false;
  }
}

async function sendEncrypted(to, plaintext) {
  const ok = await ensureSession(to);
  if (!ok) { alert('Session konnte nicht erstellt werden.'); return; }

  const envelope = await SignalSession.encryptMessage(sessions[to], plaintext);
  store('sessions', sessions);

  const msgId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const ephemeralSec = ephemeralMode ? parseInt($('ephemeralTimer').value) : 0;
  sendWS({
    type: 'message', to,
    body: envelope,
    ephemeral: ephemeralMode,
    msgId,
  });

  if (!contacts[to].messages) contacts[to].messages = [];
  contacts[to].messages.push({ from: 'me', text: plaintext, timestamp: Date.now(), ephemeral: ephemeralMode });
  store('contacts', contacts);
  renderMessages();
  renderConversations();
}

async function processIncomingMessage(msg) {
  const senderId = msg.from;
  if (!contacts[senderId]) {
    contacts[senderId] = { id: senderId, name: senderId.substring(0, 8) + '...', addedAt: Date.now(), messages: [] };
  }
  try {
    const plaintext = await SignalSession.decrypt(sessions[senderId], msg.body);
    if (!contacts[senderId].messages) contacts[senderId].messages = [];
    contacts[senderId].messages.push({ from: senderId, text: plaintext, timestamp: Date.now(), ephemeral: msg.ephemeral });
    if (msg.ephemeral && msg.body.expiresIn) {
      setTimeout(() => {
        const m = contacts[senderId].messages;
        const idx = m.findIndex(x => x.text === plaintext);
        if (idx >= 0) m.splice(idx, 1);
        store('contacts', contacts);
        renderConversations();
        if (currentChat === senderId) renderMessages();
      }, msg.body.expiresIn);
    }
    store('contacts', contacts);
    renderConversations();
    if (currentChat === senderId) renderMessages();
  } catch (err) {
    console.error('Decrypt error:', err);
  }
}

async function fetchIdentityPackage(userId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingFetches.delete(key); resolve(null); }, 5000);
    const key = 'fetch_identity:' + userId;
    pendingFetches.set(key, (pkg) => { clearTimeout(timer); resolve(pkg); });
    sendWS({ type: 'fetch_identity', userId });
  });
}

function renderConversations() {
  const list = $('convList');
  const sorted = Object.values(contacts).sort((a, b) => {
    const aL = a.messages && a.messages.length ? a.messages[a.messages.length - 1].timestamp : a.addedAt || 0;
    const bL = b.messages && b.messages.length ? b.messages[b.messages.length - 1].timestamp : b.addedAt || 0;
    return bL - aL;
  });

  if (sorted.length === 0) {
    list.innerHTML = '<div class="conv-empty">Noch keine Kontakte.<br>Klicke + um jemanden hinzuzufügen.</div>';
    return;
  }

  list.innerHTML = sorted.map(c => {
    const active = currentChat === c.id ? ' active' : '';
    const last = c.messages && c.messages.length ? c.messages[c.messages.length - 1].text : 'Keine Nachrichten';
    return `<div class="conv-item${active}" onclick="openChat('${c.id}')">
      <div class="conv-avatar">${escapeHtml(getContactName(c.id).charAt(0).toUpperCase())}</div>
      <div class="conv-info">
        <div class="conv-name">${escapeHtml(getContactName(c.id))}</div>
        <div class="conv-preview">${escapeHtml(last.substring(0, 40))}</div>
      </div>
      <div class="conv-meta"><span class="conv-time">${formatTime(c.messages && c.messages.length ? c.messages[c.messages.length - 1].timestamp : c.addedAt)}</span></div>
    </div>`;
  }).join('');
}

function renderMessages() {
  const list = $('messagesList');
  if (!currentChat || !contacts[currentChat]) { list.innerHTML = ''; return; }
  const msgs = contacts[currentChat].messages || [];
  let html = '', lastDate = '';

  for (const m of msgs) {
    const d = new Date(m.timestamp);
    const dateStr = d.toLocaleDateString();
    if (dateStr !== lastDate) { html += `<div class="date-separator">${dateStr}</div>`; lastDate = dateStr; }
    const isMe = m.from === 'me';
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const ephTag = m.ephemeral ? '<span class="msg-ephemeral"> ⏱️</span>' : '';
    const senderTag = !isMe ? `<div class="msg-sender">${escapeHtml(getContactName(currentChat))}</div>` : '';
    html += `<div class="message ${isMe ? 'out' : 'in'}">
      ${senderTag}
      <div class="msg-text">${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>
      <div class="msg-meta"><span>${time}</span>${ephTag}</div>
    </div>`;
  }
  list.innerHTML = html;
  list.scrollTop = list.scrollHeight;
}

async function setupUI() {
  $('btnGenerate').onclick = async () => {
    try {
      const identity = await GhostIdentity.generate();
      myIdentity = identity;
      store('identity', identity);
      $('seedWords').textContent = identity.mnemonic;
      $('setupGenerate').style.display = 'none';
      $('setupSeed').style.display = 'block';
      verifyStep = 0;
    } catch (e) { $('setupError').textContent = e.message; }
  };

  $('btnRestore').onclick = () => { $('setupGenerate').style.display = 'none'; $('setupRestore').style.display = 'block'; };
  $('btnBack').onclick = () => { $('setupRestore').style.display = 'none'; $('setupGenerate').style.display = 'block'; };

  $('btnDoRestore').onclick = async () => {
    const mnemonic = $('seedInput').value.trim();
    if (!mnemonic) return;
    try {
      myIdentity = await GhostIdentity.restore(mnemonic);
      store('identity', myIdentity);
      $('setupRestore').style.display = 'none';
      showIdentity();
    } catch (e) { $('setupError').textContent = e.message; }
  };

  let verifyStep = 0, verifyExpected = '';
  $('btnConfirmSeed').onclick = () => {
    if (verifyStep === 0) {
      const words = myIdentity.mnemonic.split(' ');
      const idx = Math.floor(Math.random() * 12) + 1;
      verifyExpected = words[idx - 1];
      $('verifyIndex').textContent = idx;
      $('seedVerify').style.display = 'block';
      $('btnConfirmSeed').textContent = 'Weiter';
      verifyStep = 1;
    } else {
      if ($('verifyInput').value.trim().toLowerCase() === verifyExpected.toLowerCase()) {
        $('setupSeed').style.display = 'none';
        showIdentity();
      } else { $('verifyError').textContent = 'Falsches Wort.'; }
    }
  };
  $('btnShowAgain').onclick = () => { $('seedVerify').style.display = 'none'; verifyStep = 0; $('btnConfirmSeed').textContent = 'Ich habe sie aufgeschrieben'; };

  $('btnCopyId').onclick = () => {
    navigator.clipboard.writeText(myIdentity.identityId);
    $('btnCopyId').textContent = 'Kopiert!';
    setTimeout(() => $('btnCopyId').textContent = 'ID kopieren', 1500);
  };

  $('btnShowQR').onclick = showQRModal;

  $('btnStartChat').onclick = () => enterMessenger();
}

function enterMessenger() {
  $('setupIdentity').style.display = 'none';
  $('setupScreen').style.display = 'none';
  $('app').style.display = 'flex';
  $('userName').textContent = myIdentity.identityId.substring(0, 12) + '...';
  $('userAvatar').textContent = '👻';
  $('settingsId').textContent = myIdentity.identityId;
  connectWS();
  renderConversations();
}

function showIdentity() {
  $('myIdentityId').textContent = myIdentity.identityId;
  $('setupIdentity').style.display = 'block';
}

function showQRModal() {
  const pkg = GhostIdentity.getIdentityPackage(myIdentity);
  const qrData = GhostIdentity.toQRString(pkg);
  generateQR($('qrCanvas'), qrData);
  $('qrLink').textContent = qrData;
  $('qrModal').style.display = 'flex';
}

window.hideQR = () => { $('qrModal').style.display = 'none'; };
window.showAddContact = () => { $('addContactModal').style.display = 'flex'; $('contactInput').value = ''; $('contactResult').innerHTML = ''; };
window.hideAddContact = () => { $('addContactModal').style.display = 'none'; };

window.addContact = async () => {
  let input = $('contactInput').value.trim();
  if (!input) return;
  $('contactResult').innerHTML = '<div style="color:var(--text-secondary);font-size:13px">Laden...</div>';

  try {
    let pkg = null, contactId = null;

    if (input.startsWith('ghost:')) {
      const raw = GhostIdentity.fromQRString(input);
      pkg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      contactId = GhostIdentity.getId(pkg.sk);
    } else if (input.startsWith('{')) {
      pkg = JSON.parse(input);
      contactId = GhostIdentity.getId(pkg.sk);
    } else {
      contactId = input;
      const raw = await fetchIdentityPackage(input);
      if (!raw) throw new Error('User nicht gefunden. Muss sich zuerst anmelden.');
      pkg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    if (!pkg || !pkg.spk || !pkg.ik) throw new Error('Ungültiges Identity-Package');
    if (contactId === myIdentity.identityId) throw new Error('Das bist du selbst.');

    contacts[contactId] = {
      id: contactId,
      name: contactId.substring(0, 8) + '...',
      identityPackage: pkg,
      addedAt: Date.now(),
      messages: contacts[contactId] ? contacts[contactId].messages || [] : [],
    };

    store('contacts', contacts);
    hideAddContact();
    renderConversations();
    openChat(contactId);
  } catch (e) {
    $('contactResult').innerHTML = `<div class="auth-error">${e.message}</div>`;
  }
};

window.openChat = async (contactId) => {
  currentChat = contactId;
  $('chatEmpty').style.display = 'none';
  $('chatView').style.display = 'flex';
  $('sidebar').classList.add('hidden');
  $('chatName').textContent = getContactName(contactId);
  $('chatAvatar').textContent = getContactName(contactId).charAt(0).toUpperCase();
  renderMessages();
};

window.closeChat = () => {
  currentChat = null;
  $('chatView').style.display = 'none';
  $('chatEmpty').style.display = 'flex';
  $('sidebar').classList.remove('hidden');
  renderConversations();
};

window.sendMessage = () => {
  const input = $('messageInput');
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = '';
  input.style.height = '40px';
  sendEncrypted(currentChat, text);
};

window.toggleEphemeral = () => {
  const bar = $('ephemeralBar');
  const show = bar.style.display === 'none';
  bar.style.display = show ? 'flex' : 'none';
  ephemeralMode = show;
};

window.deleteAllMessages = () => {
  if (currentChat && contacts[currentChat]) {
    contacts[currentChat].messages = [];
    store('contacts', contacts);
    renderMessages();
    renderConversations();
  }
};

window.showSettings = () => { $('settingsPanel').style.display = 'flex'; };
window.hideSettings = () => { $('settingsPanel').style.display = 'none'; };
window.copyMyId = () => { navigator.clipboard.writeText(myIdentity.identityId); };

window.showMySeed = () => {
  if (prompt('Gib "JA" ein:') === 'JA') alert(myIdentity.mnemonic);
};

window.deleteAccount = () => {
  if (prompt('Gib "LÖSCHEN" ein:') === 'LÖSCHEN') { localStorage.clear(); location.reload(); }
};

document.addEventListener('DOMContentLoaded', () => {
  myIdentity = load('identity');
  contacts = load('contacts') || {};
  sessions = load('sessions') || {};

  if (myIdentity) {
    enterMessenger();
  } else {
    setupUI();
  }

  const input = $('messageInput');
  if (input) {
    input.addEventListener('input', function () {
      this.style.height = '40px';
      this.style.height = Math.max(40, Math.min(this.scrollHeight, 200)) + 'px';
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  }
});
