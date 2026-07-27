(function () {
  if (window.__apiLoaded) return;
  window.__apiLoaded = true;
  var DB_KEY = 'kryotalk_db';
  var _memCache = null;
  var _blobStore = {};
  var _blobDBReady = false;
  var _blobDB = null;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function openBlobDB(cb) {
    if (_blobDB) { cb(_blobDB); return; }
    try {
      var req = indexedDB.open('kryotalk_blobs', 1);
      req.onupgradeneeded = function(e) { var db = e.target.result; if (!db.objectStoreNames.contains('files')) db.createObjectStore('files'); };
      req.onsuccess = function(e) { _blobDB = e.target.result; _blobDBReady = true; cb(_blobDB); };
      req.onerror = function() { cb(null); };
    } catch (e) { cb(null); }
  }
  function storeBlob(file) {
    var id = uid();
    _blobStore[id] = file;
    openBlobDB(function(db) {
      if (!db) return;
      try { var tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(file, id); } catch (e) {}
    });
    return id;
  }
  function getBlob(id) { return _blobStore[id] || null; }
  function deleteBlob(id) {
    if (_blobStore[id]) { delete _blobStore[id]; }
    openBlobDB(function(db) {
      if (!db) return;
      try { var tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); } catch (e) {}
    });
  }
  function loadAllBlobs(cb) {
    openBlobDB(function(db) {
      if (!db) { cb(); return; }
      try {
        var tx = db.transaction('files', 'readonly');
        var store = tx.objectStore('files');
        var req = store.openCursor();
        req.onsuccess = function(e) {
          var cursor = e.target.result;
          if (cursor) { _blobStore[cursor.key] = cursor.value; cursor.continue(); }
        };
        tx.oncomplete = function() { cb(); };
        tx.onerror = function() { cb(); };
      } catch (e) { cb(); }
    });
  }

  var DB_VERSION = 2;
  function loadDB() {
    if (_memCache) return _memCache;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) {
        _memCache = JSON.parse(raw);
        if (!_memCache._dbVersion || _memCache._dbVersion < DB_VERSION) {
          _memCache.users = _memCache.users.filter(function(u) { return u.email && u.email.indexOf('@demo.de') === -1 && u.lastIP !== 'lokal'; });
          _memCache.servers = (_memCache.servers || []).filter(function(s) { return s.id !== 'srv_demo'; });
          _memCache._dbVersion = DB_VERSION;
          saveDB(_memCache);
        }
        return _memCache;
      }
    } catch (e) {}
    _memCache = seedDB();
    return _memCache;
  }
  function saveDB(db) {
    _memCache = db;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return; } catch (e) {}
    console.warn('[DB] localStorage full, data only in memory this session.');
  }
  function hashPw(pw) { var h = 0; for (var i = 0; i < pw.length; i++) { h = ((h << 5) - h + pw.charCodeAt(i)) | 0; } return 'h_' + h.toString(36); }
  function fileToBase64(file) { return new Promise(function(r) { var rd = new FileReader(); rd.onload = function() { r(rd.result); }; rd.onerror = function() { r(''); }; rd.readAsDataURL(file); }); }
  var _TPIXEL='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function toFileUrl(p) {
    if (!p) return _TPIXEL;
    if (p.indexOf('blob:') === 0 || p.indexOf('data:') === 0) return p;
    if (p.indexOf('http') === 0 || p.indexOf('/') === 0 || p.indexOf('file:') === 0) return p;
    var blob = getBlob(p);
    if (blob) return URL.createObjectURL(blob);
    return _TPIXEL;
  }
  function seedDB() {
    var now = Date.now();
    var db={
      users:[],
      servers:[],
      messages:{},
      dms:[],friends:[],friendRequests:[],adminPassword:'h_uar8c5',loginMedia:{path:'',kind:''}
    };
    saveDB(db);return db;
  }
  function pickMediaViaInput(accept,maxMB){return new Promise(function(resolve){var i=document.createElement('input');i.type='file';i.accept=accept||'*/*';i.style.display='none';document.body.appendChild(i);var limit=maxMB||200;var limitBytes=limit*1024*1024;var cleaned=false;function cleanup(){if(!cleaned){cleaned=true;try{document.body.removeChild(i);}catch(e){}}}
i.onchange=async function(){var f=i.files[0];cleanup();if(!f){resolve({ok:false,canceled:true});return;}if(f.size>limitBytes){resolve({ok:false,error:'Datei zu gross (max '+limit+'MB)'});return;}var mt=f.type||'';var kind=mt.indexOf('video')!==-1?'video':mt.indexOf('gif')!==-1?'gif':'image';var blobId=storeBlob(f);var blobUrl=URL.createObjectURL(f);resolve({ok:true,path:blobId,blobUrl:blobUrl,filename:f.name,size:f.size,mimetype:mt,kind:kind,isGif:mt.indexOf('gif')!==-1});};
i.addEventListener('cancel',function(){cleanup();resolve({ok:false,canceled:true});});
i.click();});}
  function pickViaInput(accept,multi){return new Promise(function(resolve){var i=document.createElement('input');i.type='file';i.accept=accept||'*/*';i.multiple=!!multi;i.style.display='none';document.body.appendChild(i);var cleaned=false;function cleanup(){if(!cleaned){cleaned=true;try{document.body.removeChild(i);}catch(e){}}}
i.onchange=async function(){var files=Array.from(i.files);cleanup();if(!files.length){resolve({ok:false,canceled:true});return;}var r=[];for(var j=0;j<files.length;j++){if(files[j].size>200*1024*1024)continue;var blobId=storeBlob(files[j]);r.push({ok:true,path:blobId,blobUrl:URL.createObjectURL(files[j]),filename:files[j].name,size:files[j].size,mimetype:files[j].type});}if(multi)resolve({ok:true,attachments:r});else resolve(r[0]||{ok:false});};
i.addEventListener('cancel',function(){cleanup();resolve({ok:false,canceled:true});});
i.click();});}
  function findUser(db,id){return db.users.find(function(u){return u.id===id;});}
  function findUserByName(db,n){return db.users.find(function(u){return u.username===n;});}
  function getServer(db,sid){return db.servers.find(function(s){return s.id===sid;});}
  function publicUser(u){if(!u)return null;return{id:u.id,username:u.username,email:u.email,phone:u.phone||'',avatarPath:u.avatarPath,bannerPath:u.bannerPath,aboutMe:u.aboutMe,status:u.status,accentColor:u.accentColor,language:u.language,is_admin:u.is_admin,is_owner:u.is_owner,lastIP:u.lastIP,lastLogin:u.lastLogin,createdAt:u.createdAt,twoFactorEnabled:u.twoFactorEnabled,emailVerified:u.emailVerified,notifications:u.notifications||{desktop:true,sound:true,preview:true,mentionsOnly:false},privacy:u.privacy||{allowDM:true,allowFriendReq:true,showActivity:true,showIP:false},accessibility:u.accessibility||{},theme:u.theme||'dark',backgroundPath:u.backgroundPath||'',backgroundKind:u.backgroundKind||'',backgroundSound:u.backgroundSound||false,backgroundBlur:u.backgroundBlur||0,advanced:u.advanced||{},rarityKey:u.rarityKey||'common',rarityLabel:u.rarityLabel||'Gewoehnlich'};}
  function pickViaInputMulti(accept){return pickViaInput(accept,true);}

  function genCode(){return Math.floor(100000+Math.random()*900000).toString();}
  function sendVerificationEmail(toEmail,code,subject){
    if (typeof emailjs !== 'undefined') {
      return emailjs.send('service_sci0apd','template_qihho5f',{code:code,to_email:toEmail}).then(function(){return{sent:true,code:code};}).catch(function(e){console.error('[EmailJS]',e);return{sent:false,code:code,reason:'emailjsError'};});
    }
    return Promise.resolve({sent:false,code:code,reason:'noEmailJS'});
  }

  function getAPIEmailKey(){return localStorage.getItem('kryotalk_web3forms_key')||'';}
  function setAPIEmailKey(k){localStorage.setItem('kryotalk_web3forms_key',k);}

  var _REG_URL='https://raw.githubusercontent.com/Zahnfeetewz/kryotalk/main/usernames.json';
  var _remoteUsernamesCache=null;
  function fetchTakenUsernames(){
    if(_remoteUsernamesCache) return Promise.resolve(_remoteUsernamesCache);
    return fetch(_REG_URL+'?t='+Date.now()).then(function(r){if(!r.ok) throw new Error('HTTP '+r.status);return r.json();}).then(function(d){var l=d.usernames||[];_remoteUsernamesCache=l;return l;}).catch(function(e){console.error('[UsernameRegistry] fetch failed:',e);return null;});
  }
  function invalidateUsernameCache(){_remoteUsernamesCache=null;}
  function registerUsernameGlobal(username){
    var token=localStorage.getItem('kryotalk_gh_token')||'';
    if(!token) return Promise.resolve();
    invalidateUsernameCache();
    return fetchTakenUsernames().then(function(list){
      if(!list) return;
      if(list.indexOf(username)!==-1) return;
      list.push(username);
      _remoteUsernamesCache=list;
      return fetch('https://api.github.com/repos/Zahnfeetewz/kryotalk/contents/usernames.json',{
        method:'PUT',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({message:'register: '+username,content:btoa(unescape(encodeURIComponent(JSON.stringify({usernames:list})))),branch:'main'})
      }).then(function(){invalidateUsernameCache();}).catch(function(e){console.error('[UsernameRegistry]',e);});
    });
  }
  function syncAllUsernamesGlobal(){
    var token=localStorage.getItem('kryotalk_gh_token')||'';
    if(!token) return Promise.resolve();
    var db=loadDB();
    var localNames=db.users.map(function(u){return u.username;}).filter(Boolean);
    if(!localNames.length) return Promise.resolve();
    invalidateUsernameCache();
    return fetchTakenUsernames().then(function(list){
      if(!list) return;
      var changed=false;
      localNames.forEach(function(n){if(list.indexOf(n)===-1){list.push(n);changed=true;}});
      if(!changed) return;
      _remoteUsernamesCache=list;
      return fetch('https://api.github.com/repos/Zahnfeetewz/kryotalk/contents/usernames.json',{
        method:'PUT',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({message:'sync usernames: '+localNames.join(', '),content:btoa(unescape(encodeURIComponent(JSON.stringify({usernames:list})))),branch:'main'})
      }).then(function(){invalidateUsernameCache();}).catch(function(e){console.error('[UsernameRegistry] sync failed:',e);});
    });
  }

  window.api={
    toFileUrl:toFileUrl,
    register:function(username,password,email){var db=loadDB();if(findUserByName(db,username))return Promise.resolve({ok:false,error:'Benutzername vergeben'});if(db.users.find(function(u){return u.email===email;}))return Promise.resolve({ok:false,error:'E-Mail bereits registriert'});return fetchTakenUsernames().then(function(remote){if(remote===null) throw new Error('Cloud-Registry nicht erreichbar — bitte Internetverbindung prüfen');if(remote.indexOf(username)!==-1) throw new Error('Benutzername vergeben');}).then(function(){return fetch('https://api.ipify.org?format=json').then(function(r){return r.json();}).then(function(d){return d.ip||'unbekannt';}).catch(function(){return 'unbekannt';});}).then(function(ip){var vCode=genCode();var u={id:uid(),username:username,email:email,passwordHash:hashPw(password),phone:'',avatarPath:'',bannerPath:'',aboutMe:'',status:'online',accentColor:'#5865f2',language:'de',is_admin:db.users.length===0,is_owner:db.users.length===0,lastIP:ip,lastLogin:Date.now(),createdAt:Date.now(),twoFactorEnabled:false,emailVerified:false,verificationCode:vCode,verificationCodeExpires:Date.now()+300000,notifications:{desktop:true,sound:true,preview:true,mentionsOnly:false},privacy:{allowDM:true,allowFriendReq:true,showActivity:true,showIP:false},accessibility:{},theme:'dark',backgroundPath:'',backgroundKind:'',backgroundSound:false,backgroundBlur:0,advanced:{},rarityKey:'common',rarityLabel:'Gewoehnlich'};db.users.push(u);saveDB(db);return sendVerificationEmail(email,vCode,'Kryotalk — E-Mail verifizieren').then(function(r){registerUsernameGlobal(username);return{ok:true,user:publicUser(u),sent:r.sent,devMode:true,code:vCode};});}).catch(function(e){return{ok:false,error:e.message||'Benutzername vergeben'};});},
    login:function(username,password){var db=loadDB();var u=findUserByName(db,username);if(!u)return Promise.resolve({ok:false,error:'Benutzer nicht gefunden'});if(u.passwordHash&&hashPw(password)!==u.passwordHash)return Promise.resolve({ok:false,error:'Falsches Passwort'});u.lastLogin=Date.now();saveDB(db);return fetch('https://api.ipify.org?format=json').then(function(r){return r.json();}).then(function(d){u.lastIP=d.ip||u.lastIP;saveDB(db);}).catch(function(){}).then(function(){return Promise.resolve({ok:true,user:publicUser(u)});});},
    checkUsername:function(username){var db=loadDB();var CS='abcdefghijklmnopqrstuvwxyz0123456789_';var taken=!!findUserByName(db,username);var takenOfSameLen=db.users.filter(function(u){return u.username.length===username.length;}).length;var max=Math.pow(CS.length,username.length);var remaining=Math.max(max-takenOfSameLen,0);var rl=username.length<=1?{key:'legendary',label:'Legendär'}:username.length<=2?{key:'epic',label:'Episch'}:username.length<=3?{key:'rare',label:'Selten'}:username.length<=5?{key:'uncommon',label:'Ungewöhnlich'}:undefined;return fetchTakenUsernames().then(function(remote){if(remote===null) return{ok:false,error:'Cloud-Registry nicht erreichbar — bitte Internet prüfen'};var remoteTaken=remote.indexOf(username)!==-1;var allTaken=taken||remoteTaken;return{ok:true,available:!allTaken,taken:allTaken,rarityKey:rl?rl.key:'common',rarityLabel:rl?rl.label:'Gewöhnlich',remaining:remaining};});},
    getIP:function(){return fetch('https://api.ipify.org?format=json').then(function(r){return r.json();}).then(function(d){return{ok:true,ip:d.ip||'unbekannt'};}).catch(function(){return{ok:true,ip:'unbekannt'};});},
    getUserPublic:function(username){var db=loadDB();var u=findUserByName(db,username);return Promise.resolve(u?{ok:true,user:publicUser(u)}:{ok:false,error:'Nicht gefunden'});},
    changePassword:function(userId,oldPw,newPw){var db=loadDB();var u=findUser(db,userId);if(!u)return Promise.resolve({ok:false});if(u.passwordHash&&hashPw(oldPw)!==u.passwordHash)return Promise.resolve({ok:false,error:'Falsches Passwort'});u.passwordHash=hashPw(newPw);saveDB(db);return Promise.resolve({ok:true});},
    pickImage:function(kind){return pickMediaViaInput('image/*');},
    pickBackground:function(){return pickMediaViaInput('image/*,video/*');},
    updateProfile:function(userId,patch){var db=loadDB();var u=findUser(db,userId);if(!u)return Promise.resolve({ok:false});Object.keys(patch||{}).forEach(function(k){u[k]=patch[k];});saveDB(db);return Promise.resolve({ok:true,user:publicUser(u)});},
    getProfile:function(userId){var db=loadDB();var u=findUser(db,userId);return Promise.resolve(u?{ok:true,user:publicUser(u)}:{ok:false});},
    adminLogin:function(pw,username){if(username!=='lol')return Promise.resolve({ok:false,error:'Kein Admin-Zugang'});var db=loadDB();if(!db.adminPassword)return Promise.resolve({ok:true,firstTime:true});if(hashPw(pw)!==db.adminPassword)return Promise.resolve({ok:false,error:'Falsches Passwort'});return Promise.resolve({ok:true});},
    adminSetPassword:function(pw){var db=loadDB();db.adminPassword=hashPw(pw);saveDB(db);return Promise.resolve({ok:true});},
    adminGetAllUsers:function(){var db=loadDB();return Promise.resolve({ok:true,users:db.users.map(publicUser)});},
    adminDeleteUser:function(userId){var db=loadDB();db.users=db.users.filter(function(u){return u.id!==userId;});saveDB(db);return Promise.resolve({ok:true});},
    adminToggleAdmin:function(userId){var db=loadDB();var u=findUser(db,userId);if(u){u.is_admin=!u.is_admin;saveDB(db);}return Promise.resolve({ok:true});},
    serverCreate:function(name,userId){var db=loadDB();var sid=uid();var s={id:sid,name:name,ownerId:userId,icon:null,description:'',inviteCode:uid().slice(0,8).toUpperCase(),members:[userId],channels:[{id:uid(),name:'general',type:'text',serverId:sid}],categories:[{id:uid(),name:'TEXT'}],roles:[]};db.servers.push(s);saveDB(db);return Promise.resolve(s);},
    serverUpdate:function(serverId,data){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:false});Object.keys(data||{}).forEach(function(k){if(k!=='serverId')s[k]=data[k];});saveDB(db);return Promise.resolve({ok:true});},
    serverGetAll:function(){var db=loadDB();return Promise.resolve({ok:true,servers:db.servers});},
    serverGetForUser:function(userId){var db=loadDB();var ss=db.servers.filter(function(s){return s.members&&s.members.indexOf(userId)!==-1;});return Promise.resolve({ok:true,servers:ss});},
    serverGetById:function(serverId){var db=loadDB();var s=getServer(db,serverId);return Promise.resolve(s?{ok:true,server:s}:{ok:false});},
    serverJoin:function(serverId,userId){var db=loadDB();var s=getServer(db,serverId);if(s&&s.members.indexOf(userId)===-1){s.members.push(userId);saveDB(db);}return Promise.resolve({ok:true});},
    serverJoinByCode:function(code,userId){if(!code)return Promise.resolve({ok:false,error:'Ungueltig'});var db=loadDB();var s=db.servers.find(function(s){return s.inviteCode===code.toUpperCase();});if(!s)return Promise.resolve({ok:false,error:'Ungueltig'});if(s.members.indexOf(userId)===-1)s.members.push(userId);saveDB(db);return Promise.resolve({ok:true,server:s});},
    serverLeave:function(serverId,userId){var db=loadDB();var s=getServer(db,serverId);if(s){s.members=s.members.filter(function(m){return m!==userId;});saveDB(db);}return Promise.resolve({ok:true});},
    serverDelete:function(serverId){var db=loadDB();db.servers=db.servers.filter(function(s){return s.id!==serverId;});saveDB(db);return Promise.resolve({ok:true});},
    serverAddChannel:function(serverId,name,type){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:false});var ch={id:uid(),name:name,type:type||'text',serverId:serverId};s.channels.push(ch);saveDB(db);return Promise.resolve(ch);},
    serverDeleteChannel:function(serverId,channelId){var db=loadDB();var s=getServer(db,serverId);if(s){s.channels=s.channels.filter(function(c){return c.id!==channelId;});delete db.messages[channelId];saveDB(db);}return Promise.resolve({ok:true});},
    serverInvite:function(){return Promise.resolve({ok:true});},
    serverRegenerateInviteCode:function(serverId){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:false});s.inviteCode=uid().slice(0,8).toUpperCase();saveDB(db);return Promise.resolve({ok:true,code:s.inviteCode});},
    serverAddRole:function(serverId,name,color){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:false});var r={id:uid(),name:name,color:color,memberIds:[]};if(!s.roles)s.roles=[];s.roles.push(r);saveDB(db);return Promise.resolve(r);},
    serverDeleteRole:function(serverId,roleId){var db=loadDB();var s=getServer(db,serverId);if(s){s.roles=(s.roles||[]).filter(function(r){return r.id!==roleId;});saveDB(db);}return Promise.resolve({ok:true});},
    serverAssignRole:function(serverId,roleId,userId){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:true});var r=(s.roles||[]).find(function(r){return r.id===roleId;});if(r&&!r.memberIds) r.memberIds=[];if(r&&r.memberIds.indexOf(userId)===-1)r.memberIds.push(userId);saveDB(db);return Promise.resolve({ok:true});},
    serverRemoveRole:function(serverId,roleId,userId){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:true});var r=(s.roles||[]).find(function(r){return r.id===roleId;});if(r&&r.memberIds)r.memberIds=r.memberIds.filter(function(id){return id!==userId;});saveDB(db);return Promise.resolve({ok:true});},
    serverUpdateRole:function(serverId,roleId,patch){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:false});var r=(s.roles||[]).find(function(r){return r.id===roleId;});if(r)Object.keys(patch||{}).forEach(function(k){r[k]=patch[k];});saveDB(db);return Promise.resolve(r||{ok:false});},
    serverGetMembers:function(serverId){var db=loadDB();var s=getServer(db,serverId);if(!s)return Promise.resolve({ok:true,users:[]});var users=s.members.map(function(id){return findUser(db,id);}).filter(Boolean).map(publicUser);return Promise.resolve({ok:true,users:users});},
    upload:function(file){var blobId=storeBlob(file);return Promise.resolve({ok:true,path:blobId,blobUrl:URL.createObjectURL(file),filename:file.name,size:file.size,mimetype:file.type});},
    messagesGet:function(channelId){var db=loadDB();return Promise.resolve(db.messages[channelId]||[]);},
    messagesSend:function(channelId,serverId,authorId,content,attachments){var db=loadDB();if(!db.messages[channelId])db.messages[channelId]=[];var m={id:uid(),channelId:channelId,serverId:serverId,authorId:authorId,content:content,attachments:attachments||[],reactions:[],timestamp:Date.now()};db.messages[channelId].push(m);saveDB(db);return Promise.resolve({ok:true,message:m});},
    messagesDelete:function(msgId){var db=loadDB();Object.keys(db.messages).forEach(function(k){db.messages[k]=db.messages[k].filter(function(m){return m.id!==msgId;});});saveDB(db);return Promise.resolve({ok:true});},
    messagesReact:function(msgId,emoji,userId){var db=loadDB();Object.keys(db.messages).forEach(function(k){db.messages[k].forEach(function(m){if(m.id===msgId){if(!m.reactions)m.reactions=[];var existing=m.reactions.find(function(r){return r.emoji===emoji;});if(existing){if(existing.userIds.indexOf(userId)===-1)existing.userIds.push(userId);else existing.userIds=existing.userIds.filter(function(id){return id!==userId;});if(existing.userIds.length===0)m.reactions=m.reactions.filter(function(r){return r.emoji!==emoji;});}else{m.reactions.push({emoji:emoji,userIds:[userId]});}}});});saveDB(db);return Promise.resolve({ok:true});},
    messagesEdit:function(msgId,content){var db=loadDB();Object.keys(db.messages).forEach(function(k){db.messages[k].forEach(function(m){if(m.id===msgId)m.content=content;});});saveDB(db);return Promise.resolve({ok:true});},
    messagesPin:function(){return Promise.resolve({ok:true});},
    messagesPickFile:function(){return pickViaInput('image/*,video/*,audio/*,*/*',true);},
    dmGetOrCreate:function(userId1,userId2){var db=loadDB();var dm=db.dms.find(function(d){return d.participants&&d.participants.indexOf(userId1)!==-1&&d.participants.indexOf(userId2)!==-1;});if(!dm){dm={id:uid(),participants:[userId1,userId2],messages:[]};db.dms.push(dm);saveDB(db);}return Promise.resolve(dm);},
    dmGetAll:function(userId){var db=loadDB();var dms=db.dms.filter(function(d){return d.participants&&d.participants.indexOf(userId)!==-1;});return Promise.resolve(dms);},
    dmGetMessages:function(dmId){var db=loadDB();var dm=db.dms.find(function(d){return d.id===dmId;});return Promise.resolve(dm?dm.messages:[]);},
    dmSend:function(dmId,authorId,content,attachments){var db=loadDB();var dm=db.dms.find(function(d){return d.id===dmId;});if(!dm)return Promise.resolve({ok:false});if(!dm.messages)dm.messages=[];var m={id:uid(),authorId:authorId,content:content,attachments:attachments||[],timestamp:Date.now()};dm.messages.push(m);saveDB(db);return Promise.resolve({ok:true,message:m});},
    friendsGetList:function(userId){var db=loadDB();var frs=db.friends||[];var result=frs.filter(function(f){return f.userId1===userId||f.userId2===userId;}).map(function(f){var otherId=f.userId1===userId?f.userId2:f.userId1;return publicUser(findUser(db,otherId));}).filter(Boolean);return Promise.resolve(result);},
    friendsGetRequests:function(userId){var db=loadDB();var reqs=(db.friendRequests||[]).filter(function(r){return r.fromId===userId||r.toId===userId;}).map(function(r){return Object.assign({},r,{fromUser:publicUser(findUser(db,r.fromId))});});return Promise.resolve(reqs);},
    friendsSendRequest:function(fromId,toId){var db=loadDB();if(!db.friendRequests)db.friendRequests=[];var existing=db.friendRequests.find(function(r){return r.fromId===fromId&&r.toId===toId&&r.status==='pending';});if(existing)return Promise.resolve({ok:false,error:'Bereits gesendet'});db.friendRequests.push({id:uid(),fromId:fromId,toId:toId,status:'pending',createdAt:Date.now()});saveDB(db);return Promise.resolve({ok:true});},
    friendsAcceptRequest:function(reqId){var db=loadDB();var r=(db.friendRequests||[]).find(function(r){return r.id===reqId;});if(!r)return Promise.resolve({ok:false});r.status='accepted';if(!db.friends)db.friends=[];db.friends.push({userId1:r.fromId,userId2:r.toId,createdAt:Date.now()});saveDB(db);return Promise.resolve({ok:true});},
    friendsDeclineRequest:function(reqId){var db=loadDB();db.friendRequests=(db.friendRequests||[]).filter(function(r){return r.id!==reqId;});saveDB(db);return Promise.resolve({ok:true});},
    friendsRemove:function(userId,friendId){var db=loadDB();db.friends=(db.friends||[]).filter(function(f){return !((f.userId1===userId&&f.userId2===friendId)||(f.userId1===friendId&&f.userId2===userId));});saveDB(db);return Promise.resolve({ok:true});},
    getMedia:function(){var db=loadDB();return Promise.resolve({ok:true,media:db.loginMedia});},
    setMedia:function(path,kind){var db=loadDB();db.loginMedia={path:path,kind:kind};saveDB(db);return Promise.resolve({ok:true});},
    clearMedia:function(){var db=loadDB();db.loginMedia={path:'',kind:''};saveDB(db);return Promise.resolve({ok:true});},
    getUserById:function(userId){var db=loadDB();var u=findUser(db,userId);return Promise.resolve(u?{ok:true,user:publicUser(u)}:{ok:false});},
    getUsersByIds:function(ids){var db=loadDB();return Promise.resolve({ok:true,users:(ids||[]).map(function(id){return publicUser(findUser(db,id));}).filter(Boolean)});},
    twoFASetup:function(userId){var secret='DEMO123'+(userId||'').slice(0,4);return Promise.resolve({ok:true,secret:secret,uri:'otpauth://totp/Kryotalk:'+userId+'?secret='+secret+'&issuer=Kryotalk',qrCode:'',dataUrl:''});},
    twoFAVerify:function(userId,code){return Promise.resolve({ok:code==='000000'||code==='123456'||code.length===6});},
    twoFADisable:function(){return Promise.resolve({ok:true});},
    twoFACheckOnLogin:function(userId,code){return Promise.resolve({ok:code==='000000'||code==='123456'||code.length===6});},
    emailVerify:function(userId,code){var db=loadDB();var u=findUser(db,userId);if(!u)return Promise.resolve({ok:false,error:'User nicht gefunden'});if(u.verificationCodeExpires&&Date.now()>u.verificationCodeExpires)return Promise.resolve({ok:false,error:'Code abgelaufen'});if(u.verificationCode===code){u.emailVerified=true;u.verificationCode=null;u.verificationCodeExpires=null;saveDB(db);return Promise.resolve({ok:true});}return Promise.resolve({ok:false,error:'Falscher Code'});},
    emailResend:function(userId){var db=loadDB();var u=findUser(db,userId);if(!u)return Promise.resolve({ok:false});var vCode=genCode();u.verificationCode=vCode;u.verificationCodeExpires=Date.now()+300000;saveDB(db);return sendVerificationEmail(u.email,vCode,'Kryotalk — Code erneut senden').then(function(r){return{ok:true,sent:r.sent,devMode:true,code:vCode};});},
    emailChange:function(userId,email){var db=loadDB();var u=findUser(db,userId);if(!u)return Promise.resolve({ok:false});u.email=email;u.emailVerified=false;var vCode=genCode();u.verificationCode=vCode;u.verificationCodeExpires=Date.now()+300000;saveDB(db);return sendVerificationEmail(email,vCode,'Kryotalk — Neue E-Mail verifizieren').then(function(r){return{ok:true,sent:r.sent,devMode:!r.sent,code:vCode};});},
    forgotPassword:function(username){var db=loadDB();var u=findUserByName(db,username);if(!u)return Promise.resolve({ok:false,error:'Benutzer nicht gefunden'});var masked=u.email?u.email.replace(/^(.{2})(.*)(@.*)$/,'$1***$3'):'***@demo.de';var vCode=genCode();u.resetCode=vCode;u.resetCodeExpires=Date.now()+300000;saveDB(db);return sendVerificationEmail(u.email,vCode,'Kryotalk — Passwort zuruecksetzen').then(function(r){return{ok:true,maskedEmail:masked,sent:r.sent,devMode:!r.sent,code:vCode};});},
    resendResetCode:function(username){var db=loadDB();var u=findUserByName(db,username);if(!u)return Promise.resolve({ok:false,error:'Benutzer nicht gefunden'});var vCode=genCode();u.resetCode=vCode;u.resetCodeExpires=Date.now()+300000;saveDB(db);return sendVerificationEmail(u.email,vCode,'Kryotalk — Passwort-Reset-Code erneut senden').then(function(r){return{ok:true,sent:r.sent,devMode:!r.sent,code:vCode};});},
    resetPassword:function(username,code,newPw){var db=loadDB();var u=findUserByName(db,username);if(!u)return Promise.resolve({ok:false,error:'Benutzer nicht gefunden'});if(!u.resetCode||u.resetCode!==code)return Promise.resolve({ok:false,error:'Falscher Code'});if(u.resetCodeExpires&&Date.now()>u.resetCodeExpires)return Promise.resolve({ok:false,error:'Code abgelaufen'});u.passwordHash=hashPw(newPw);u.resetCode=null;u.resetCodeExpires=null;saveDB(db);return Promise.resolve({ok:true});},
    downloadFile:function(path,name){if(!path)return;var a=document.createElement('a');a.href=toFileUrl(path);a.download=name||'download';document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);},100);},
    dmGetAll_unread:function(){return Promise.resolve([]);},
    setEmailApiKey:function(key){setAPIEmailKey(key);return Promise.resolve({ok:true});},
    getEmailApiKey:function(){return Promise.resolve({ok:true,key:getAPIEmailKey(),hasKey:!!getAPIEmailKey()});},
    _defaultEmailKey:'e06a178a-7dc1-4bd3-ba16-1ed51161684a'
  };
  window.api.ready = new Promise(function(resolve) {
    loadAllBlobs(function() {
      console.log('[Blobs] IndexedDB loaded, ' + Object.keys(_blobStore).length + ' blobs in cache');
      syncAllUsernamesGlobal().then(function(){resolve();}).catch(function(){resolve();});
    });
  });
})();
