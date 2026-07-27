function toFileUrl(p) { if (!p) return ''; return window.api?.toFileUrl?.(p) || ''; }

function defaultAvatar(letter) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">
    <rect width="56" height="56" fill="#5865f2"/>
    <text x="28" y="36" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">${letter}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

let allUsers = [];

async function loadUsers() {
  allUsers = await window.api.adminGetAllUsers();
  renderUsers(allUsers);
}

function renderUsers(users) {
  const grid = document.getElementById('user-grid');
  const empty = document.getElementById('admin-empty');
  const count = document.getElementById('user-count');
  grid.innerHTML = '';
  count.textContent = `${users.length} ${t('usersRegistered')}`;

  if (users.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  users.forEach((u) => {
    const card = document.createElement('div');
    card.className = 'user-card';

    const avatar = u.avatarPath ? toFileUrl(u.avatarPath) : defaultAvatar((u.username || '?')[0].toUpperCase());
    const banner = u.bannerPath ? `url("${toFileUrl(u.bannerPath)}")` : 'none';
    const created = new Date(u.createdAt).toLocaleDateString(getLocale(), { day: '2-digit', month: 'long', year: 'numeric' });

    card.innerHTML = `
      <div class="user-card-banner" style="background-image:${banner}"></div>
      <div class="user-card-body">
        <img class="user-card-avatar" src="${avatar}" alt="" />
        <div class="user-card-name">${u.username}</div>
        <span class="user-card-rarity rarity-${u.rarityKey}">${u.rarityLabel}</span>
        <div class="user-card-info">
          ${t('registeredLabel')}: <span>${created}</span><br>
          IP: <span>${u.lastIP || '—'}</span><br>
          Theme: <span>${u.theme || 'dark'}</span><br>
          Admin: <span>${u.is_admin ? t('ja') : t('nein')}</span>
        </div>
        ${u.aboutMe ? `<div class="user-card-about">"${u.aboutMe}"</div>` : ''}
        <div class="user-card-actions">
          <button class="btn-admin ${u.is_admin ? 'is-admin' : ''}" data-id="${u.id}">
            ${u.is_admin ? t('revokeAdmin') : t('makeAdmin')}
          </button>
          <button class="btn-delete" data-id="${u.id}">${t('delete')}</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.btn-admin').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.adminToggleAdmin(btn.dataset.id, localStorage.getItem('currentUserId'));
      loadUsers();
    });
  });

  grid.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm(t('confirmDeleteUser'))) {
        await window.api.adminDeleteUser(btn.dataset.id, localStorage.getItem('currentUserId'));
        loadUsers();
      }
    });
  });
}

document.getElementById('admin-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderUsers(allUsers);
  renderUsers(allUsers.filter((u) => u.username.toLowerCase().includes(q)));
});

document.getElementById('back-btn').addEventListener('click', () => {
  window.location.href = 'app.html';
});
document.getElementById('nav-back').addEventListener('click', () => {
  window.location.href = 'app.html';
});

loadUsers();
