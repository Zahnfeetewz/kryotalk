const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  __electron: true,
  toFileUrl: (p) => p ? 'file://' + p.replace(/\\/g, '/') : '',
  register: (username, password, email) => ipcRenderer.invoke('auth:register', { username, password, email }),
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  checkUsername: (username) => ipcRenderer.invoke('auth:checkUsername', { username }),
  getIP: () => ipcRenderer.invoke('auth:getIP'),
  getUserPublic: (username) => ipcRenderer.invoke('auth:getUserPublic', { username }),

  pickImage: (kind) => ipcRenderer.invoke('profile:pickImage', { kind }),
  pickBackground: () => ipcRenderer.invoke('profile:pickBackground'),
  updateProfile: (userId, patch) => ipcRenderer.invoke('profile:update', { userId, patch }),
  getProfile: (userId) => ipcRenderer.invoke('profile:get', { userId }),

  adminLogin: (password) => ipcRenderer.invoke('admin:login', { password }),
  adminSetPassword: (password) => ipcRenderer.invoke('admin:setPassword', { password }),
  adminGetAllUsers: () => ipcRenderer.invoke('admin:getAllUsers'),
  adminDeleteUser: (userId, callerId) => ipcRenderer.invoke('admin:deleteUser', { userId, callerId }),
  adminToggleAdmin: (userId, callerId) => ipcRenderer.invoke('admin:toggleAdmin', { userId, callerId }),

  serverCreate: (name, userId) => ipcRenderer.invoke('server:create', { name, userId }),
  serverUpdate: (serverId, data) => ipcRenderer.invoke('server:update', { serverId, ...data }),
  serverGetAll: () => ipcRenderer.invoke('server:getAll'),
  serverGetForUser: (userId) => ipcRenderer.invoke('server:getForUser', { userId }),
  serverGetById: (serverId) => ipcRenderer.invoke('server:getById', { serverId }),
  serverJoin: (serverId, userId) => ipcRenderer.invoke('server:join', { serverId, userId }),
  serverJoinByCode: (code, userId) => ipcRenderer.invoke('server:joinByCode', { code, userId }),
  serverLeave: (serverId, userId) => ipcRenderer.invoke('server:leave', { serverId, userId }),
  serverDelete: (serverId, userId) => ipcRenderer.invoke('server:delete', { serverId, userId }),
  serverAddChannel: (serverId, name, type) => ipcRenderer.invoke('server:addChannel', { serverId, name, type }),
  serverDeleteChannel: (serverId, channelId) => ipcRenderer.invoke('server:deleteChannel', { serverId, channelId }),
  serverInvite: (serverId, username) => ipcRenderer.invoke('server:invite', { serverId, username }),
  serverRegenerateInviteCode: (serverId) => ipcRenderer.invoke('server:regenerateInviteCode', { serverId }),

  serverAddRole: (serverId, name, color) => ipcRenderer.invoke('server:addRole', { serverId, name, color }),
  serverDeleteRole: (serverId, roleId) => ipcRenderer.invoke('server:deleteRole', { serverId, roleId }),
  serverAssignRole: (serverId, roleId, userId) => ipcRenderer.invoke('server:assignRole', { serverId, roleId, userId }),
  serverRemoveRole: (serverId, roleId, userId) => ipcRenderer.invoke('server:removeRole', { serverId, roleId, userId }),
  serverUpdateRole: (serverId, roleId, patch) => ipcRenderer.invoke('server:updateRole', { serverId, roleId, patch }),

  upload: (file) => ipcRenderer.invoke('upload:file', { filePath: file.path, name: file.name }),
  saveFileAs: (filePath) => ipcRenderer.invoke('file:saveAs', { filePath }),

  messagesGet: (channelId) => ipcRenderer.invoke('messages:get', { channelId }),
  messagesSearch: (query, channelId, serverId) => ipcRenderer.invoke('messages:search', { query, channelId, serverId }),
  messagesSend: (channelId, serverId, authorId, content, attachments) => ipcRenderer.invoke('messages:send', { channelId, serverId, authorId, content, attachments }),
  messagesDelete: (msgId) => ipcRenderer.invoke('messages:delete', { msgId }),
  messagesReact: (msgId, emoji, userId) => ipcRenderer.invoke('messages:react', { msgId, emoji, userId }),
  messagesEdit: (msgId, content) => ipcRenderer.invoke('messages:edit', { msgId, content }),
  messagesPin: (msgId) => ipcRenderer.invoke('messages:pin', { msgId }),
  messagesPickFile: () => ipcRenderer.invoke('messages:pickFile'),

  dmGetOrCreate: (userId1, userId2) => ipcRenderer.invoke('dm:getOrCreate', { userId1, userId2 }),
  dmGetAll: (userId) => ipcRenderer.invoke('dm:getAll', { userId }),
  dmGetMessages: (dmId) => ipcRenderer.invoke('dm:getMessages', { dmId }),
  dmSend: (dmId, authorId, content, attachments) => ipcRenderer.invoke('dm:send', { dmId, authorId, content, attachments }),

  friendsGetList: (userId) => ipcRenderer.invoke('friends:getList', { userId }),
  friendsGetRequests: (userId) => ipcRenderer.invoke('friends:getRequests', { userId }),
  friendsSendRequest: (fromId, toId) => ipcRenderer.invoke('friends:sendRequest', { fromId, toId }),
  friendsAcceptRequest: (reqId) => ipcRenderer.invoke('friends:acceptRequest', { reqId }),
  friendsDeclineRequest: (reqId) => ipcRenderer.invoke('friends:declineRequest', { reqId }),
  friendsRemove: (userId, friendId) => ipcRenderer.invoke('friends:remove', { userId, friendId }),

  getMedia: () => ipcRenderer.invoke('login:getMedia'),
  setMedia: (mediaPath, mediaKind) => ipcRenderer.invoke('login:setMedia', { mediaPath, mediaKind }),
  clearMedia: () => ipcRenderer.invoke('login:clearMedia'),

  getUserById: (userId) => ipcRenderer.invoke('users:getById', { userId }),
  getUsersByIds: (userIds) => ipcRenderer.invoke('users:getByIds', { userIds }),

  serverGetMembers: (serverId) => ipcRenderer.invoke('server:getMembers', { serverId }),

  changePassword: (userId, oldPassword, newPassword) => ipcRenderer.invoke('auth:changePassword', { userId, oldPassword, newPassword }),

  twoFASetup: (userId) => ipcRenderer.invoke('2fa:setup', { userId }),
  twoFAVerify: (userId, code) => ipcRenderer.invoke('2fa:verify', { userId, code }),
  twoFADisable: (userId, code) => ipcRenderer.invoke('2fa:disable', { userId, code }),
  twoFACheckOnLogin: (userId, code) => ipcRenderer.invoke('2fa:checkOnLogin', { userId, code }),

  emailVerify: (userId, code) => ipcRenderer.invoke('email:verify', { userId, code }),
  emailResend: (userId) => ipcRenderer.invoke('email:resend', { userId }),
  emailChange: (userId, newEmail) => ipcRenderer.invoke('email:change', { userId, newEmail }),

  forgotPassword: (username) => ipcRenderer.invoke('auth:forgotPassword', { username }),
  resendResetCode: (username) => ipcRenderer.invoke('auth:resendResetCode', { username }),
  resetPassword: (username, code, newPassword) => ipcRenderer.invoke('auth:resetPassword', { username, code, newPassword }),
});
