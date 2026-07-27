/* ── KryoTalk Calls Module (WebRTC + Socket.io) ── */
(function () {
  if (window.__callsLoaded) return;
  window.__callsLoaded = true;

  var socket = null;
  var peerConnection = null;
  var localStream = null;
  var remoteStream = null;
  var currentCallId = null;
  var currentCallType = null;
  var callPartnerName = '';
  var callPartnerAvatar = '';
  var callPartnerId = '';
  var isMuted = false;
  var isVideoOff = false;
  var isDeafened = false;
  var iceCandidates = [];
  var ringtone = null;
  var callTimerInterval = null;
  var callStartTime = 0;

  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ];

  function toFileUrl(p) {
    if (!p) return '';
    return window.api?.toFileUrl?.(p) || ('file://' + p.replace(/\\/g, '/'));
  }

  function defaultAvatar(letter) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#5865f2"/><text x="64" y="80" font-size="48" fill="#fff" text-anchor="middle" font-family="sans-serif">' + (letter || '?') + '</text></svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function getAvatarUrl(userId, avatarPath) {
    if (avatarPath) return toFileUrl(avatarPath);
    var name = callPartnerName || '?';
    return defaultAvatar(name[0]);
  }

  /* ── Socket Connection ── */
  function connectSocket() {
    if (socket && socket.connected) return;
    if (typeof io === 'undefined') {
      var attempts = 0;
      var wait = setInterval(function () {
        attempts++;
        if (typeof io !== 'undefined' || attempts > 30) {
          clearInterval(wait);
          if (typeof io !== 'undefined') doConnect();
        }
      }, 200);
      return;
    }
    doConnect();
  }

  function doConnect() {
    if (socket && socket.connected) return;
    var isElectron = !!(window.api && window.api.__electron);
    var serverUrl = isElectron ? 'http://localhost:3000' : window.location.origin;
    socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    window.KryoCalls._socket = socket;

    socket.on('connect', function () {
      var userId = localStorage.getItem('currentUserId');
      if (userId) socket.emit('identify', userId);
    });

    var events = ['call:incoming', 'call:ringing', 'call:accepted', 'call:rejected', 'call:ended', 'call:offer', 'call:answer', 'call:ice-candidate', 'call:toggle-audio', 'call:toggle-video'];
    events.forEach(function (evt) {
      socket.on(evt, function (data) { handleSignalEvent(evt, data); });
    });

    socket.on('voice:state', function (state) {
      window.__voiceChannelState = state || {};
      if (typeof window.renderVoiceChannels === 'function') window.renderVoiceChannels();
    });

    socket.on('typing:update', function (data) {
      if (typeof window.handleTypingUpdate === 'function') window.handleTypingUpdate(data);
    });

    socket.on('typing:state', function (data) {
      if (typeof window.handleTypingState === 'function') window.handleTypingState(data);
    });
  }

  function emit(evt, data) {
    if (socket && socket.emit) socket.emit(evt, data);
  }

  function ensureConnected(callback) {
    if (socket && socket.connected) {
      var userId = localStorage.getItem('currentUserId');
      if (userId) socket.emit('identify', userId);
      callback();
      return;
    }
    connectSocket();
    var check = setInterval(function () {
      if (socket && socket.connected) {
        clearInterval(check);
        var userId = localStorage.getItem('currentUserId');
        if (userId) socket.emit('identify', userId);
        callback();
      }
    }, 100);
    setTimeout(function () { clearInterval(check); }, 5000);
  }

  /* ── Signal Handling ── */
  function handleSignalEvent(event, data) {
    if (event === 'call:incoming') {
      currentCallId = data.callId;
      currentCallType = data.callType;
      callPartnerName = data.callerName;
      callPartnerAvatar = data.callerAvatar || '';
      callPartnerId = data.callerId || '';
      showIncomingCall(data);
    } else if (event === 'call:ringing') {
      currentCallId = data.callId;
      showOutgoingRinging();
    } else if (event === 'call:accepted') {
      currentCallId = data.callId;
      hideIncomingCall();
      hideOutgoingRinging();
      startMediaAndOffer();
    } else if (event === 'call:rejected') {
      cleanupCall();
      endCallUI();
      showCallNotification('Anruf abgelehnt');
    } else if (event === 'call:ended') {
      cleanupCall();
      endCallUI();
      showCallNotification('Call beendet');
    } else if (event === 'call:offer') {
      handleOffer(data);
    } else if (event === 'call:answer') {
      handleAnswer(data);
    } else if (event === 'call:ice-candidate') {
      if (peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function () {});
      } else {
        iceCandidates.push(data.candidate);
      }
    } else if (event === 'call:toggle-audio') {
      var rv = document.getElementById('call-remote-video');
      if (rv && rv.srcObject) rv.srcObject.getAudioTracks().forEach(function (t) { t.enabled = !data.muted; });
    } else if (event === 'call:toggle-video') {
      var rv2 = document.getElementById('call-remote-video');
      if (rv2 && rv2.srcObject) rv2.srcObject.getVideoTracks().forEach(function (t) { t.enabled = !data.off; });
    }
  }

  /* ── WebRTC ── */
  function createPeerConnection() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    iceCandidates = [];

    peerConnection.onicecandidate = function (event) {
      if (event.candidate && socket && currentCallId) {
        emit('call:ice-candidate', { callId: currentCallId, candidate: event.candidate });
      }
    };

    peerConnection.ontrack = function (event) {
      remoteStream = event.streams[0];
      var remoteVideo = document.getElementById('call-remote-video');
      if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.muted = false;
        remoteVideo.play().catch(function() {});
      }
    };

    peerConnection.onconnectionstatechange = function () {
      var state = peerConnection ? peerConnection.connectionState : '';
      if (state === 'disconnected' || state === 'failed') {
        endCall();
      }
    };

    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        peerConnection.addTrack(track, localStream);
      });
    }

    return peerConnection;
  }

  async function ensureMedia(type) {
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    if (type === 'screen') {
      try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        localStream.getVideoTracks()[0].onended = function () {
          if (currentCallType === 'screen') toggleScreenShare();
        };
      } catch (e) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      }
    } else if (type === 'video') {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    var localVideo = document.getElementById('call-local-video');
    if (localVideo) localVideo.srcObject = localStream;
    return localStream;
  }

  async function handleOffer(data) {
    try {
      await ensureMedia(data.callType || currentCallType || 'audio');
      if (!peerConnection) createPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      for (var i = 0; i < iceCandidates.length; i++) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[i]));
      }
      iceCandidates = [];
      var answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      emit('call:answer', { callId: currentCallId, answer: answer });
      showActiveCall();
    } catch (e) {
      console.error('[Call] Offer-Fehler:', e);
      showCallNotification('Anruf konnte nicht angenommen werden');
      cleanupCall();
      endCallUI();
    }
  }

  async function handleAnswer(data) {
    try {
      if (peerConnection && data.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (var i = 0; i < iceCandidates.length; i++) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[i]));
        }
        iceCandidates = [];
      }
    } catch (e) {
      console.error('[Call] Answer-Fehler:', e);
    }
  }

  async function startMediaAndOffer() {
    try {
      await ensureMedia(currentCallType);
      createPeerConnection();
      var offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      emit('call:offer', { callId: currentCallId, callType: currentCallType, offer: offer });
      showActiveCall();
    } catch (e) {
      console.error('[Call] Media-Fehler:', e);
      showCallNotification('Zugriff auf Mikrofon/Kamera verweigert');
      cleanupCall();
      endCallUI();
    }
  }

  /* ── Call Actions ── */
  window.startCall = async function (targetUserId, targetUsername, callType) {
    callPartnerName = targetUsername;
    callPartnerId = targetUserId;
    currentCallType = callType || 'voice';
    showOutgoingRinging();
    ensureConnected(function () {
      emit('call:start', { targetId: targetUserId, callType: currentCallType });
    });
  };

  window.acceptCall = async function () {
    if (!currentCallId) return;
    hideIncomingCall();
    stopRingtone();
    emit('call:accept', { callId: currentCallId });
  };

  window.rejectCall = function () {
    if (!currentCallId) return;
    emit('call:reject', { callId: currentCallId });
    hideIncomingCall();
    stopRingtone();
    currentCallId = null;
  };

  window.endCall = function () {
    if (currentCallId && socket) {
      emit('call:end', { callId: currentCallId });
    }
    cleanupCall();
    endCallUI();
  };

  window.toggleMute = function () {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(function (t) { t.enabled = !isMuted; });
    if (currentCallId) emit('call:toggle-audio', { callId: currentCallId, muted: isMuted });
    var btn = document.getElementById('call-btn-mute');
    if (btn) {
      btn.classList.toggle('active', isMuted);
      updateMuteIcon(btn, isMuted);
    }
    syncCallBarButtons();
  };

  window.toggleCamera = function () {
    if (!localStream) return;
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach(function (t) { t.enabled = !isVideoOff; });
    if (currentCallId) emit('call:toggle-video', { callId: currentCallId, off: isVideoOff });
    var btn = document.getElementById('call-btn-camera');
    if (btn) {
      btn.classList.toggle('active', isVideoOff);
      updateCameraIcon(btn, isVideoOff);
    }
    var localVideo = document.getElementById('call-local-video');
    if (localVideo) localVideo.style.opacity = isVideoOff ? '0.3' : '1';
    syncCallBarButtons();
  };

  window.toggleDeafen = function () {
    isDeafened = !isDeafened;
    var remoteVideo = document.getElementById('call-remote-video');
    if (remoteVideo && remoteVideo.srcObject) {
      remoteVideo.srcObject.getAudioTracks().forEach(function (t) { t.enabled = !isDeafened; });
    }
    var btn = document.getElementById('call-btn-deafen');
    if (btn) {
      btn.classList.toggle('active', isDeafened);
      updateDeafenIcon(btn, isDeafened);
    }
    if (isDeafened && !isMuted) {
      window.toggleMute();
    }
    if (!isDeafened && isMuted) {
      window.toggleMute();
    }
    syncCallBarButtons();
  };

  function updateDeafenIcon(btn, deafened) {
    if (deafened) {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    } else {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/></svg>';
    }
  }

  window.toggleScreenShare = async function () {
    var btn = document.getElementById('call-btn-screen');
    if (btn && btn.classList.contains('active')) {
      btn.classList.remove('active');
      try {
        var camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        var newTrack = camStream.getVideoTracks()[0];
        if (peerConnection) {
          var sender = peerConnection.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
          if (sender) await sender.replaceTrack(newTrack);
        }
        if (localStream) {
          var old = localStream.getVideoTracks()[0];
          if (old) { old.stop(); localStream.removeTrack(old); }
          localStream.addTrack(newTrack);
        }
        var lv = document.getElementById('call-local-video');
        if (lv) lv.srcObject = localStream;
      } catch (e) { console.error('[Call] Kamera-Fehler:', e); }
    } else {
      try {
        var screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
        var screenTrack = screenStream.getVideoTracks()[0];
        screenTrack.onended = function () { toggleScreenShare(); };
        if (peerConnection) {
          var sender2 = peerConnection.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
          if (sender2) await sender2.replaceTrack(screenTrack);
        }
        if (localStream) {
          var oldV = localStream.getVideoTracks()[0];
          if (oldV) { oldV.stop(); localStream.removeTrack(oldV); }
          localStream.addTrack(screenTrack);
        }
        var lv2 = document.getElementById('call-local-video');
        if (lv2) lv2.srcObject = localStream;
        if (btn) btn.classList.add('active');
      } catch (e) { console.error('[Call] Screen-Share-Fehler:', e); }
    }
  };

  /* ── Icon Updates ── */
  function updateMuteIcon(btn, muted) {
    if (muted) {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    } else {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
  }

  function updateCameraIcon(btn, off) {
    if (off) {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M23 7l-7 5 7 5V7z" fill="currentColor"/><rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="2"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    } else {
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M23 7l-7 5 7 5V7z" fill="currentColor"/><rect x="1" y="5" width="15" height="14" rx="2" stroke="currentColor" stroke-width="2"/></svg>';
    }
  }

  /* ── Call Bar Button Event Listeners ── */
  function initCallBarButtons() {
    var barMute = document.getElementById('bar-btn-mute');
    var barDeafen = document.getElementById('bar-btn-deafen');
    var barCamera = document.getElementById('bar-btn-camera');
    var barScreen = document.getElementById('bar-btn-screen');
    var barEnd = document.getElementById('bar-btn-end');
    if (barMute) barMute.addEventListener('click', function () { window.toggleMute(); });
    if (barDeafen) barDeafen.addEventListener('click', function () { window.toggleDeafen(); });
    if (barCamera) barCamera.addEventListener('click', function () { window.toggleCamera(); });
    if (barScreen) barScreen.addEventListener('click', function () { window.toggleScreenShare(); });
    if (barEnd) barEnd.addEventListener('click', function () { window.endCall(); });
  }
  initCallBarButtons();

  /* ── Cleanup ── */
  function cleanupCall() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    remoteStream = null;
    currentCallId = null;
    currentCallType = null;
    isMuted = false;
    isVideoOff = false;
    isDeafened = false;
    iceCandidates = [];
    stopCallTimer();
  }

  /* ── UI ── */
  function showIncomingCall(data) {
    var overlay = document.getElementById('call-incoming-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    var nameEl = document.getElementById('call-incoming-name');
    var typeEl = document.getElementById('call-incoming-type');
    var avatarEl = document.getElementById('call-incoming-avatar');
    if (nameEl) nameEl.textContent = data.callerName;
    if (typeEl) typeEl.textContent = data.callType === 'video' ? 'Videoanruf' : data.callType === 'screen' ? 'Bildschirm-Übertragung' : 'Sprachanruf';
    if (avatarEl) {
      var avUrl = getAvatarUrl(data.callerId, data.callerAvatar);
      avatarEl.innerHTML = '<img src="' + avUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />';
    }
    playRingtone();
  }

  function hideIncomingCall() {
    var overlay = document.getElementById('call-incoming-overlay');
    if (overlay) overlay.style.display = 'none';
    stopRingtone();
  }

  function showOutgoingRinging() {
    var overlay = document.getElementById('call-outgoing-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    var nameEl = document.getElementById('call-outgoing-name');
    var typeEl = document.getElementById('call-outgoing-type');
    var avatarEl = document.getElementById('call-outgoing-avatar');
    if (nameEl) nameEl.textContent = callPartnerName;
    if (typeEl) typeEl.textContent = currentCallType === 'video' ? 'Videoanruf' : currentCallType === 'screen' ? 'Bildschirm-Übertragung' : 'Sprachanruf';
    if (avatarEl) {
      var avUrl = getAvatarUrl(callPartnerId, callPartnerAvatar);
      avatarEl.innerHTML = '<img src="' + avUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />';
    }
    playRingtone();
  }

  function hideOutgoingRinging() {
    var overlay = document.getElementById('call-outgoing-overlay');
    if (overlay) overlay.style.display = 'none';
    stopRingtone();
  }

  function showActiveCall() {
    hideIncomingCall();
    hideOutgoingRinging();
    var overlay = document.getElementById('call-active-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    var headerName = document.getElementById('call-active-name');
    if (headerName) headerName.textContent = callPartnerName;

    var localVideo = document.getElementById('call-local-video');
    var remoteVideo = document.getElementById('call-remote-video');
    var audioBg = document.getElementById('call-audio-bg');
    var audioAvatar = document.getElementById('call-audio-avatar');
    var audioName = document.getElementById('call-audio-name');

    if (currentCallType === 'video' || currentCallType === 'screen') {
      if (localVideo) { localVideo.style.display = 'block'; localVideo.style.opacity = '1'; }
      if (remoteVideo) { remoteVideo.style.display = 'block'; remoteVideo.style.opacity = '1'; remoteVideo.style.position = ''; remoteVideo.style.pointerEvents = ''; }
      if (audioBg) audioBg.style.display = 'none';
    } else {
      if (localVideo) localVideo.style.display = 'none';
      if (remoteVideo) { remoteVideo.style.display = 'block'; remoteVideo.style.opacity = '0'; remoteVideo.style.position = 'absolute'; remoteVideo.style.pointerEvents = 'none'; remoteVideo.style.width = '1px'; remoteVideo.style.height = '1px'; }
      if (audioBg) audioBg.style.display = 'flex';
      if (audioAvatar) {
        var avUrl = getAvatarUrl(callPartnerId, callPartnerAvatar);
        audioAvatar.innerHTML = '<img src="' + avUrl + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />';
      }
      if (audioName) audioName.textContent = callPartnerName;
    }

    isMuted = false;
    isVideoOff = false;
    isDeafened = false;
    var muteBtn = document.getElementById('call-btn-mute');
    var camBtn = document.getElementById('call-btn-camera');
    var screenBtn = document.getElementById('call-btn-screen');
    var deafenBtn = document.getElementById('call-btn-deafen');
    if (muteBtn) { muteBtn.classList.remove('active'); updateMuteIcon(muteBtn, false); }
    if (camBtn) { camBtn.classList.remove('active'); updateCameraIcon(camBtn, false); }
    if (screenBtn) screenBtn.classList.remove('active');
    if (deafenBtn) { deafenBtn.classList.remove('active'); updateDeafenIcon(deafenBtn, false); }

    showCallBar();
    startCallTimer();
  }

  function startCallTimer() {
    patchStartCallTimer();
  }

  function stopCallTimer() {
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    var timerEl = document.getElementById('call-active-timer');
    if (timerEl) timerEl.textContent = '00:00';
    var barTimer = document.getElementById('active-call-bar-timer');
    if (barTimer) barTimer.textContent = '00:00';
  }

  function endCallUI() {
    var o1 = document.getElementById('call-incoming-overlay');
    var o2 = document.getElementById('call-outgoing-overlay');
    var o3 = document.getElementById('call-active-overlay');
    if (o1) o1.style.display = 'none';
    if (o2) o2.style.display = 'none';
    if (o3) o3.style.display = 'none';
    var localVideo = document.getElementById('call-local-video');
    var remoteVideo = document.getElementById('call-remote-video');
    if (localVideo) { localVideo.srcObject = null; localVideo.style.display = 'none'; localVideo.style.opacity = '1'; }
    if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; remoteVideo.style.opacity = '1'; remoteVideo.style.position = ''; remoteVideo.style.pointerEvents = ''; remoteVideo.style.width = ''; remoteVideo.style.height = ''; }
    hideCallBar();
    stopCallTimer();
    stopRingtone();
  }

  /* ── Active Call Bar (small bar in chat area) ── */
  function showCallBar() {
    var bar = document.getElementById('active-call-bar');
    if (!bar) return;
    bar.style.display = 'block';
    var nameEl = document.getElementById('active-call-bar-name');
    if (nameEl) nameEl.textContent = callPartnerName;
    syncCallBarButtons();
  }

  function hideCallBar() {
    var bar = document.getElementById('active-call-bar');
    if (bar) bar.style.display = 'none';
  }

  function syncCallBarButtons() {
    var muteBtn = document.getElementById('bar-btn-mute');
    var deafBtn = document.getElementById('bar-btn-deafen');
    var camBtn = document.getElementById('bar-btn-camera');
    var screenBtn = document.getElementById('bar-btn-screen');
    if (muteBtn) {
      muteBtn.classList.toggle('active', isMuted);
      muteBtn.innerHTML = isMuted
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
    if (deafBtn) {
      deafBtn.classList.toggle('active', isDeafened);
      deafBtn.innerHTML = isDeafened
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 18v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="1" y="15" width="4" height="6" rx="1" fill="currentColor"/><rect x="19" y="15" width="4" height="6" rx="1" fill="currentColor"/></svg>';
    }
    if (camBtn) {
      camBtn.classList.toggle('active', isVideoOff);
    }
  }

  function syncBarTimer() {
    var barTimer = document.getElementById('active-call-bar-timer');
    var elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    var min = Math.floor(elapsed / 60);
    var sec = elapsed % 60;
    if (barTimer) barTimer.textContent = (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function patchStartCallTimer() {
    callStartTime = Date.now();
    var timerEl = document.getElementById('call-active-timer');
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(function () {
      var elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      var min = Math.floor(elapsed / 60);
      var sec = elapsed % 60;
      var timeStr = (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
      if (timerEl) timerEl.textContent = timeStr;
      syncBarTimer();
    }, 1000);
  }

  function showCallNotification(msg) {
    var el = document.getElementById('call-notification');
    if (!el) {
      el = document.createElement('div');
      el.id = 'call-notification';
      el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#232428;color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.3s';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 3000);
  }

  /* ── Ringtone (Discord-style alternating) ── */
  var ringtoneInterval = null;

  function playRingtone() {
    try {
      stopRingtone();
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      ringtone = { ctx: ctx };
      var playing = false;

      function ringPulse() {
        if (!ringtone) return;
        try {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = playing ? 880 : 660;
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.4);
          playing = !playing;
        } catch (e) {}
      }

      ringPulse();
      ringtoneInterval = setInterval(ringPulse, 500);
    } catch (e) {}
  }

  function stopRingtone() {
    if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
    if (ringtone) {
      try { ringtone.ctx.close(); } catch (e) {}
      ringtone = null;
    }
  }

  /* ── Public API ── */
  window.__voiceChannelState = {};

  window.joinVoiceChannel = function (channelId) {
    ensureConnected(function () {
      emit('voice:join', { channelId: channelId });
    });
  };

  window.leaveVoiceChannel = function () {
    emit('voice:leave', {});
  };

  window.KryoCalls = {
    connectSocket: connectSocket,
    startCall: window.startCall,
    acceptCall: window.acceptCall,
    rejectCall: window.rejectCall,
    endCall: window.endCall,
    toggleMute: window.toggleMute,
    toggleCamera: window.toggleCamera,
    toggleDeafen: window.toggleDeafen,
    toggleScreenShare: window.toggleScreenShare,
    joinVoiceChannel: window.joinVoiceChannel,
    leaveVoiceChannel: window.leaveVoiceChannel,
    _socket: null
  };
})();
