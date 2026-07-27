import { x25519 } from '@noble/curves/ed25519';
import { getPublicKey as edGetPub, sign as edSign, verify as edVerify, utils as edUtils, etc as edEtc } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

edEtc.sha512Sync = sha512;

function concat(...bufs) {
  const total = bufs.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

async function aesGcmEncrypt(plaintext, keyHex, iv) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(ciphertext, keyHex, iv) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(pt);
}

function incrementChain(chainKeyHex) {
  const CK = hexToBytes(chainKeyHex);
  return {
    msgKey: hmac(sha256, CK, new Uint8Array([0x01])),
    nextChainKey: bytesToHex(hmac(sha256, CK, new Uint8Array([0x02]))),
  };
}

function deriveMessageKeys(msgKey) {
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode('GhostMsgKeys');
  const d = hkdf(sha256, msgKey, salt, info, 80);
  return { cipherKey: bytesToHex(d.subarray(0, 32)), iv: d.subarray(48, 60) };
}

function kdfChain(rkHex, dhOut) {
  const RK = typeof rkHex === 'string' ? hexToBytes(rkHex) : rkHex;
  const input = typeof dhOut === 'string' ? hexToBytes(dhOut) : dhOut;
  const okm = hkdf(sha256, input, RK, new TextEncoder().encode('kdf'), 64);
  return { rootKey: bytesToHex(okm.subarray(0, 32)), chainKey: bytesToHex(okm.subarray(32, 64)) };
}

function dhX25519(privHex, pubHex) {
  return x25519.getSharedSecret(hexToBytes(privHex), hexToBytes(pubHex));
}

export const GhostIdentity = {
  async generate() {
    const mnemonic = generateMnemonic(wordlist);
    return this.restore(mnemonic);
  },

  async restore(mnemonic) {
    if (!validateMnemonic(mnemonic, wordlist)) throw new Error('Ungültige Seed-Phrase');
    const seed = mnemonicToSeedSync(mnemonic);

    const signingKey = edUtils.randomPrivateKey();
    const signingPub = edGetPub(signingKey);

    const identityKey = x25519.utils.randomPrivateKey();
    const identityPub = x25519.getPublicKey(identityKey);

    const signedPreKey = x25519.utils.randomPrivateKey();
    const signedPrePub = x25519.getPublicKey(signedPreKey);

    const identityId = bytesToHex(sha256(edGetPub(signingKey)));

    const signedPrePubSig = await edSign(signedPrePub, signingKey);

    return {
      mnemonic,
      identityId,
      signingKeyPrivate: bytesToHex(signingKey),
      signingKeyPublic: bytesToHex(signingPub),
      identityKeyPrivate: bytesToHex(identityKey),
      identityKeyPublic: bytesToHex(identityPub),
      signedPreKeyPrivate: bytesToHex(signedPreKey),
      signedPreKeyPublic: bytesToHex(signedPrePub),
      signedPreKeySig: bytesToHex(signedPrePubSig),
    };
  },

  getId(signingPubHex) {
    return bytesToHex(sha256(hexToBytes(signingPubHex)));
  },

  getIdentityPackage(identity) {
    return JSON.stringify({
      v: 3,
      spk: identity.signedPreKeyPublic,
      spkSig: identity.signedPreKeySig,
      ik: identity.identityKeyPublic,
      sk: identity.signingKeyPublic,
    });
  },

  parseIdentityPackage(data) {
    return typeof data === 'string' ? JSON.parse(data) : data;
  },

  toQRString(pkg) { return 'ghost:' + btoa(typeof pkg === 'string' ? pkg : JSON.stringify(pkg)); },
  fromQRString(qr) {
    if (!qr.startsWith('ghost:')) throw new Error('Ungültiges Format');
    return JSON.parse(atob(qr.slice(6)));
  },
};

export const SignalSession = {
  create() {
    return {
      rootKey: null,
      sendingChainKey: null,
      receivingChainKey: null,
      remoteRatchetKey: null,
      ephemeralKeyPair: null,
      messageNumber: 0,
      receivedMessageNumber: 0,
      previousChainLength: 0,
      isAlice: false,
    };
  },

  initAsAlice(rootKeyHex, sendingChainKeyHex, ephPrivHex, ephPubHex, remoteRatchetKeyHex) {
    const s = this.create();
    s.isAlice = true;
    s.rootKey = rootKeyHex;
    s.sendingChainKey = sendingChainKeyHex;
    s.ephemeralKeyPair = { publicKey: ephPubHex, privateKey: ephPrivHex };
    s.remoteRatchetKey = remoteRatchetKeyHex;
    s.messageNumber = 0;
    return s;
  },

  initAsBob(rootKeyHex, receivingChainKeyHex, ephPrivHex, ephPubHex, remoteRatchetKeyHex) {
    const s = this.create();
    s.isAlice = false;
    s.rootKey = rootKeyHex;
    s.receivingChainKey = receivingChainKeyHex;
    s.ephemeralKeyPair = { publicKey: ephPubHex, privateKey: ephPrivHex };
    s.remoteRatchetKey = remoteRatchetKeyHex;
    s.receivedMessageNumber = 0;
    return s;
  },

  encrypt(session, plaintext) {
    const mk = incrementChain(session.sendingChainKey);
    session.sendingChainKey = mk.nextChainKey;
    const keys = deriveMessageKeys(mk.msgKey);
    const iv = keys.iv;
    const msgNum = session.messageNumber;
    session.messageNumber++;

    return { ciphertext: null, plaintext, ratchetKey: session.ephemeralKeyPair?.publicKey, msgNumber: msgNum, iv: bytesToHex(iv), cipherKey: keys.cipherKey };
  },

  async encryptMessage(session, plaintext) {
    const enc = this.encrypt(session, plaintext);
    const ct = await aesGcmEncrypt(plaintext, enc.cipherKey, hexToBytes(enc.iv));
    return { ciphertext: bytesToHex(ct), ratchetKey: enc.ratchetKey, msgNumber: enc.msgNumber, iv: enc.iv };
  },

  async decrypt(session, envelope) {
    if (envelope.ratchetKey && envelope.ratchetKey !== session.remoteRatchetKey) {
      this._ratchetStep(session, envelope.ratchetKey);
    }

    if (!session.receivingChainKey) throw new Error('No receiving chain');

    const mk = incrementChain(session.receivingChainKey);
    session.receivingChainKey = mk.nextChainKey;
    const keys = deriveMessageKeys(mk.msgKey);
    const plaintext = await aesGcmDecrypt(hexToBytes(envelope.ciphertext), keys.cipherKey, hexToBytes(envelope.iv));
    session.receivedMessageNumber++;
    return plaintext;
  },

  _ratchetStep(session, newRemoteRatchetKey) {
    if (session.sendingChainKey) {
      session.previousChainLength += session.messageNumber;
    }

    const dh1 = dhX25519(session.ephemeralKeyPair.privateKey, newRemoteRatchetKey);
    const r1 = kdfChain(session.rootKey, dh1);
    session.rootKey = r1.rootKey;
    session.receivingChainKey = r1.chainKey;

    const newPriv = x25519.utils.randomPrivateKey();
    const newPub = x25519.getPublicKey(newPriv);

    const dh2 = dhX25519(newPriv, newRemoteRatchetKey);
    const r2 = kdfChain(session.rootKey, dh2);
    session.rootKey = r2.rootKey;
    session.sendingChainKey = r2.chainKey;

    session.ephemeralKeyPair = { publicKey: bytesToHex(newPub), privateKey: bytesToHex(newPriv) };
    session.remoteRatchetKey = newRemoteRatchetKey;
    session.messageNumber = 0;
    session.receivedMessageNumber = 0;
  },
};

export const SignalX3DH = {
  performAsInitiator(identity, contactPkg) {
    const ephPriv = x25519.utils.randomPrivateKey();
    const ephPub = x25519.getPublicKey(ephPriv);

    const dh1 = dhX25519(identity.identityKeyPrivate, contactPkg.spk);
    const dh2 = dhX25519(ephPriv, contactPkg.ik);
    const dh3 = dhX25519(ephPriv, contactPkg.spk);

    const combined = concat(dh1, dh2, dh3);
    const sharedSecret = sha256(combined);

    const dhInit = dhX25519(ephPriv, contactPkg.spk);
    const { rootKey, chainKey } = kdfChain(bytesToHex(sharedSecret), dhInit);

    const session = SignalSession.initAsAlice(
      rootKey, chainKey,
      bytesToHex(ephPriv), bytesToHex(ephPub),
      contactPkg.spk
    );

    return { session, ephemeralPublicKey: bytesToHex(ephPub) };
  },

  performAsResponder(identity, ephPubHex, initiatorIKpubHex) {
    if (!initiatorIKpubHex) throw new Error('Initiator Identity Key fehlt');

    const dh1 = dhX25519(identity.signedPreKeyPrivate, initiatorIKpubHex);
    const dh2 = dhX25519(identity.identityKeyPrivate, ephPubHex);
    const dh3 = dhX25519(identity.signedPreKeyPrivate, ephPubHex);

    const combined = concat(dh1, dh2, dh3);
    const sharedSecret = sha256(combined);

    const dhResp = dhX25519(identity.signedPreKeyPrivate, ephPubHex);
    const { rootKey, chainKey: receivingChainKey } = kdfChain(bytesToHex(sharedSecret), dhResp);

    const ephPriv = x25519.utils.randomPrivateKey();
    const ephPub = x25519.getPublicKey(ephPriv);

    const dhSend = dhX25519(bytesToHex(ephPriv), ephPubHex);
    const { rootKey: newRootKey, chainKey: sendingChainKey } = kdfChain(rootKey, dhSend);

    const session = {
      rootKey: newRootKey,
      sendingChainKey,
      receivingChainKey,
      remoteRatchetKey: ephPubHex,
      ephemeralKeyPair: { publicKey: bytesToHex(ephPub), privateKey: bytesToHex(ephPriv) },
      messageNumber: 0,
      receivedMessageNumber: 0,
      previousChainLength: 0,
      isAlice: false,
    };

    return { session };
  },
};

export function generateQR(container, data) {
  const size = 256, modules = 25, cellSize = size / modules;
  const ctx = container.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const seed = Array.from(sha256(new TextEncoder().encode(data)));
  let si = 0;
  const rng = () => { const v = (seed[si++ % 32] || 0) / 256; return v; };
  ctx.fillStyle = '#000000';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      const finder = (r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7);
      if (finder) {
        const edge = r === 0 || c === 0 || r === 6 || c === 6 || r === modules - 7 || r === modules - 1 || c === modules - 7 || c === modules - 1;
        const center = r >= 2 && r <= 4 && c >= 2 && c <= 4 || r >= 2 && r <= 4 && c >= modules - 5 && c <= modules - 3 || r >= modules - 5 && r <= modules - 3 && c >= 2 && c <= 4;
        if (edge || center) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      } else if (r === 6 || c === 6) {
        if ((r + c) % 2 === 0) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      } else if (rng() > 0.5) {
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
  }
}
