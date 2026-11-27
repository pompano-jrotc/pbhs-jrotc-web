// POST /api/send-message-push
//
// Sends an FCM push notification to the other participants of a conversation
// when a message is sent. Any approved user may call this.
//
// Body:
//   idToken         string  Firebase ID token of the sender
//   conversationId  string  Firestore conversation document ID
//   senderName      string  Display name shown in the notification
//   messageText     string  Message preview (truncated server-side to 100 chars)

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';
import { checkRateLimit, getClientIp } from '../lib/rateLimit.js';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

let _serviceAccount = null;
function getServiceAccount() {
  if (_serviceAccount) return _serviceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.'); }
  if (parsed.private_key?.includes('\\n')) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  _serviceAccount = parsed;
  return _serviceAccount;
}

let _fcmToken = null;
async function getFcmAccessToken() {
  if (_fcmToken && _fcmToken.expiresAt > Date.now() + 30_000) return _fcmToken.value;
  const account = getServiceAccount();
  const key     = await importPKCS8(account.private_key, 'RS256');
  const now     = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);
  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`FCM token exchange failed: ${data.error_description || data.error}`);
  _fcmToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fcmToken.value;
}

let _fsToken = null;
async function getFirestoreAccessToken() {
  if (_fsToken && _fsToken.expiresAt > Date.now() + 30_000) return _fsToken.value;
  const account = getServiceAccount();
  const key     = await importPKCS8(account.private_key, 'RS256');
  const now     = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .sign(key);
  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firestore token exchange failed: ${data.error_description || data.error}`);
  _fsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _fsToken.value;
}

async function fsGet(fsToken, projectId, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${fsToken}` } });
  if (!res.ok) return null;
  return res.json();
}

async function getTokensForUids(fsToken, projectId, uids) {
  const tokens = [];
  const tokenToUid = new Map();
  await Promise.all(uids.map(async uid => {
    const doc = await fsGet(fsToken, projectId, `users/${uid}`);
    if (!doc?.fields?.fcmTokens?.arrayValue?.values) return;
    for (const v of doc.fields.fcmTokens.arrayValue.values) {
      if (v.stringValue) {
        tokens.push(v.stringValue);
        tokenToUid.set(v.stringValue, uid);
      }
    }
  }));
  return { tokens, tokenToUid };
}

async function sendOne(fcmToken, fsAccessToken, projectId, title, body) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fsAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        apns: { payload: { aps: { sound: 'default' } } },
        android: { priority: 'high' },
      },
    }),
  });
  if (res.ok) return { ok: true, errorCode: null };
  const err  = await res.json().catch(() => ({}));
  const code = err.error?.details?.[0]?.errorCode || err.error?.message || 'UNKNOWN';
  return { ok: false, errorCode: code };
}

async function removeStaleTokens(fsToken, projectId, staleTokensByUid) {
  const writes = [];
  for (const [uid, badTokens] of staleTokensByUid) {
    writes.push({
      transform: {
        document: `projects/${projectId}/databases/(default)/documents/users/${uid}`,
        fieldTransforms: [{
          fieldPath: 'fcmTokens',
          removeAllFromArray: { values: badTokens.map(t => ({ stringValue: t })) },
        }],
      },
    });
  }
  if (!writes.length) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${fsToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
    }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await checkRateLimit(`msg-push:${getClientIp(req)}`, 60, 60);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const { idToken, conversationId, senderName, messageText } = req.body || {};
  if (!idToken || !conversationId || !senderName || !messageText)
    return res.status(400).json({ error: 'Missing required fields' });

  const account   = getServiceAccount();
  const projectId = account.project_id;

  // Verify caller
  let callerUid;
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer:   `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    callerUid = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const fsToken = await getFirestoreAccessToken();

  // Verify caller is approved
  const callerDoc = await fsGet(fsToken, projectId, `users/${callerUid}`);
  if (callerDoc?.fields?.approved?.booleanValue === false)
    return res.status(403).json({ error: 'Account not approved' });

  // Fetch conversation to get participant list
  const convDoc = await fsGet(fsToken, projectId, `conversations/${conversationId}`);
  if (!convDoc?.fields) return res.status(404).json({ error: 'Conversation not found' });

  const allParticipants = (convDoc.fields.participantUids?.arrayValue?.values || [])
    .map(v => v.stringValue).filter(Boolean);

  // Send only to other participants (not the sender)
  const recipients = allParticipants.filter(uid => uid !== callerUid);
  if (!recipients.length) return res.status(200).json({ sent: 0 });

  const preview = messageText.length > 100 ? messageText.slice(0, 97) + '…' : messageText;

  const { tokens, tokenToUid } = await getTokensForUids(fsToken, projectId, recipients);
  if (!tokens.length) return res.status(200).json({ sent: 0, noTokens: true });

  const fcmToken = await getFcmAccessToken();
  const results = await Promise.all(
    tokens.map(t => sendOne(t, fcmToken, projectId, senderName, preview).then(r => ({ token: t, ...r })))
  );

  const stale = results.filter(r => !r.ok && ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(r.errorCode));
  if (stale.length) {
    const byUid = new Map();
    for (const { token } of stale) {
      const u = tokenToUid.get(token);
      if (u) {
        if (!byUid.has(u)) byUid.set(u, []);
        byUid.get(u).push(token);
      }
    }
    removeStaleTokens(fsToken, projectId, byUid).catch(() => {});
  }

  return res.status(200).json({ sent: results.filter(r => r.ok).length });
}
