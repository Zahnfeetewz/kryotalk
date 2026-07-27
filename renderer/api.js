(function () {
  if (window.__apiLoaded) return;
  window.__apiLoaded = true;

  var isElectron = !!(window.api && window.api.__electron);

  function toFileUrl(p) {
    if (!p) return '';
    if (isElectron || window.location.protocol === 'file:') {
      return 'file://' + p.replace(/\\/g, '/');
    }
    var filename = p.split(/[/\\]/).pop();
    return window.location.origin + '/uploads/' + encodeURIComponent(filename);
  }

  if (isElectron) {
    window.api.toFileUrl = toFileUrl;
    window.api.downloadFile = function(attPath, attName) {
      if (window.api.saveFileAs) {
        window.api.saveFileAs(attPath);
      }
    };
    return;
  }

  var API_BASE = window.location.origin + '/api';

  function apiCall(endpoint, data) {
    return fetch(API_BASE + '/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    }).then(function (r) { return r.json(); });
  }

  function pickViaInput(accept, multi) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      input.multiple = !!multi;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = function () {
        var files = Array.from(input.files);
        document.body.removeChild(input);
        if (files.length === 0) { resolve({ ok: false, canceled: true }); return; }
        var formData = new FormData();
        if (files.length === 1) {
          formData.append('file', files[0]);
          fetch(API_BASE + '/upload', { method: 'POST', body: formData })
            .then(function (r) { return r.json(); })
            .then(function (result) {
              if (multi) {
                resolve(result.ok ? { ok: true, attachments: [result] } : result);
              } else {
                resolve(result);
              }
            })
            .catch(function (e) { resolve({ ok: false, error: e.message }); });
        } else {
          files.forEach(function (f) { formData.append('files', f); });
          fetch(API_BASE + '/upload-multi', { method: 'POST', body: formData })
            .then(function (r) { return r.json(); })
            .then(function (result) { resolve(result); })
            .catch(function (e) { resolve({ ok: false, error: e.message }); });
        }
      };
      input.click();
    });
  }

  function pickMediaViaInput(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = function () {
        var file = input.files[0];
        document.body.removeChild(input);
        if (!file) { resolve({ ok: false, canceled: true }); return; }
        var formData = new FormData();
        formData.append('file', file);
        fetch(API_BASE + '/upload', { method: 'POST', body: formData })
          .then(function (r) { return r.json(); })
          .then(function (result) { resolve(result); })
          .catch(function (e) { resolve({ ok: false, error: e.message }); });
      };
      input.click();
    });
  }

  window.api = {
    toFileUrl: toFileUrl,

    register: function (username, password, email) { return apiCall('auth/register', { username: username, password: password, email: email }); },
    login: function (username, password) { return apiCall('auth/login', { username: username, password: password }); },
    checkUsername: function (username) { return apiCall('auth/checkUsername', { username: username }); },
    getIP: function () { return apiCall('auth/getIP'); },
    getUserPublic: function (username) { return apiCall('auth/getUserPublic', { username: username }); },
    changePassword: function (userId, oldPassword, newPassword) {
      return apiCall('auth/changePassword', { userId: userId, oldPassword: oldPassword, newPassword: newPassword });
    },

    pickImage: function (kind) {
      var accept = kind === 'banner' ? 'image/*' : 'image/png,image/jpeg,image/webp,image/gif';
      return pickMediaViaInput(accept);
    },
    pickBackground: function () {
      return pickMediaViaInput('image/*,video/*');
    },
    updateProfile: function (userId, patch) { return apiCall('profile/update', { userId: userId, patch: patch }); },
    getProfile: function (userId) { return apiCall('profile/get', { userId: userId }); },

    adminLogin: function (password) { return apiCall('admin/login', { password: password }); },
    adminSetPassword: function (password) { return apiCall('admin/setPassword', { password: password }); },
    adminGetAllUsers: function () { return apiCall('admin/getAllUsers'); },
    adminDeleteUser: function (userId, callerId) { return apiCall('admin/deleteUser', { userId: userId, callerId: callerId }); },
    adminToggleAdmin: function (userId, callerId) { return apiCall('admin/toggleAdmin', { userId: userId, callerId: callerId }); },

    serverCreate: function (name, userId) { return apiCall('server/create', { name: name, userId: userId }); },
    serverUpdate: function (serverId, data) { return apiCall('server/update', Object.assign({ serverId: serverId }, data)); },
    serverGetAll: function () { return apiCall('server/getAll'); },
    serverGetForUser: function (userId) { return apiCall('server/getForUser', { userId: userId }); },
    serverGetById: function (serverId) { return apiCall('server/getById', { serverId: serverId }); },
    serverJoin: function (serverId, userId) { return apiCall('server/join', { serverId: serverId, userId: userId }); },
    serverJoinByCode: function (code, userId) { return apiCall('server/joinByCode', { code: code, userId: userId }); },
    serverLeave: function (serverId, userId) { return apiCall('server/leave', { serverId: serverId, userId: userId }); },
    serverDelete: function (serverId, userId) { return apiCall('server/delete', { serverId: serverId, userId: userId }); },
    serverAddChannel: function (serverId, name, type) { return apiCall('server/addChannel', { serverId: serverId, name: name, type: type }); },
    serverDeleteChannel: function (serverId, channelId) { return apiCall('server/deleteChannel', { serverId: serverId, channelId: channelId }); },
    serverInvite: function (serverId, username) { return apiCall('server/invite', { serverId: serverId, username: username }); },
    serverRegenerateInviteCode: function (serverId) { return apiCall('server/regenerateInviteCode', { serverId: serverId }); },

    serverAddRole: function (serverId, name, color) { return apiCall('server/addRole', { serverId: serverId, name: name, color: color }); },
    serverDeleteRole: function (serverId, roleId) { return apiCall('server/deleteRole', { serverId: serverId, roleId: roleId }); },
    serverAssignRole: function (serverId, roleId, userId) { return apiCall('server/assignRole', { serverId: serverId, roleId: roleId, userId: userId }); },
    serverRemoveRole: function (serverId, roleId, userId) { return apiCall('server/removeRole', { serverId: serverId, roleId: roleId, userId: userId }); },
    serverUpdateRole: function (serverId, roleId, patch) { return apiCall('server/updateRole', { serverId: serverId, roleId: roleId, patch: patch }); },

    upload: function (file) {
      return new Promise(function(resolve) {
        var fd = new FormData();
        fd.append('file', file);
        fetch(API_BASE + '/upload', { method: 'POST', body: fd })
          .then(function(r) { return r.json(); })
          .then(function(data) { resolve(data); })
          .catch(function() { resolve({ ok: false }); });
      });
    },

    messagesGet: function (channelId) { return apiCall('messages/get', { channelId: channelId }); },
    messagesSearch: function (query, channelId, serverId) { return apiCall('messages/search', { query: query, channelId: channelId, serverId: serverId }); },
    messagesSend: function (channelId, serverId, authorId, content, attachments) {
      return apiCall('messages/send', { channelId: channelId, serverId: serverId, authorId: authorId, content: content, attachments: attachments });
    },
    messagesDelete: function (msgId) { return apiCall('messages/delete', { msgId: msgId }); },
    messagesReact: function (msgId, emoji, userId) { return apiCall('messages/react', { msgId: msgId, emoji: emoji, userId: userId }); },
    messagesEdit: function (msgId, content) { return apiCall('messages/edit', { msgId: msgId, content: content }); },
    messagesPin: function (msgId) { return apiCall('messages/pin', { msgId: msgId }); },
    messagesPickFile: function () { return pickViaInput('image/*,video/*,audio/*,*/*', true); },

    dmGetOrCreate: function (userId1, userId2) { return apiCall('dm/getOrCreate', { userId1: userId1, userId2: userId2 }); },
    dmGetAll: function (userId) { return apiCall('dm/getAll', { userId: userId }); },
    dmGetMessages: function (dmId) { return apiCall('dm/getMessages', { dmId: dmId }); },
    dmSend: function (dmId, authorId, content, attachments) {
      return apiCall('dm/send', { dmId: dmId, authorId: authorId, content: content, attachments: attachments });
    },

    friendsGetList: function (userId) { return apiCall('friends/getList', { userId: userId }); },
    friendsGetRequests: function (userId) { return apiCall('friends/getRequests', { userId: userId }); },
    friendsSendRequest: function (fromId, toId) { return apiCall('friends/sendRequest', { fromId: fromId, toId: toId }); },
    friendsAcceptRequest: function (reqId) { return apiCall('friends/acceptRequest', { reqId: reqId }); },
    friendsDeclineRequest: function (reqId) { return apiCall('friends/declineRequest', { reqId: reqId }); },
    friendsRemove: function (userId, friendId) { return apiCall('friends/remove', { userId: userId, friendId: friendId }); },

    getMedia: function () { return apiCall('login/getMedia'); },
    setMedia: function (mediaPath, mediaKind) { return apiCall('login/setMedia', { mediaPath: mediaPath, mediaKind: mediaKind }); },
    clearMedia: function () { return apiCall('login/clearMedia'); },

    getUserById: function (userId) { return apiCall('users/getById', { userId: userId }); },
    getUsersByIds: function (userIds) { return apiCall('users/getByIds', { userIds: userIds }); },

    serverGetMembers: function (serverId) { return apiCall('server/getMembers', { serverId: serverId }); },

    twoFASetup: function (userId) { return apiCall('2fa/setup', { userId: userId }); },
    twoFAVerify: function (userId, code) { return apiCall('2fa/verify', { userId: userId, code: code }); },
    twoFADisable: function (userId, code) { return apiCall('2fa/disable', { userId: userId, code: code }); },
    twoFACheckOnLogin: function (userId, code) { return apiCall('2fa/checkOnLogin', { userId: userId, code: code }); },

    emailVerify: function (userId, code) { return apiCall('email/verify', { userId: userId, code: code }); },
    emailResend: function (userId) { return apiCall('email/resend', { userId: userId }); },
    emailChange: function (userId, newEmail) { return apiCall('email/change', { userId: userId, newEmail: newEmail }); },

    forgotPassword: function (username) { return apiCall('auth/forgotPassword', { username: username }); },
    resendResetCode: function (username) { return apiCall('auth/resendResetCode', { username: username }); },
    resetPassword: function (username, code, newPassword) { return apiCall('auth/resetPassword', { username: username, code: code, newPassword: newPassword }); },

    downloadFile: function (attPath, attName) {
      var filename = attPath.split(/[/\\]/).pop();
      var a = document.createElement('a');
      a.href = window.location.origin + '/uploads/' + encodeURIComponent(filename);
      a.download = attName || filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
  };
})();
