// GET /api/leaderboard.json
//
// Public endpoint — returns cadetChallengeRecords and roster data for the
// public Battalion Leaderboard page (/leaderboard). Uses the Firebase service
// account to bypass security rules so unauthenticated visitors can see the data.
// Runs as a Vercel Edge Function.

export const config = { runtime: 'edge' };

const PROJECT_ID = 'pbhs-jrotc-web';

async function signJWT(payload, privateKeyPem) {
  const b64url = obj =>
    btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const sigInput = `${b64url({ alg:'RS256', typ:'JWT' })}.${b64url(payload)}`;
  const pemBody = privateKeyPem.replace(/-----[\w ]+-----|[\r\n]/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${sigInput}.${sig64}`;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT({
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }, sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange failed');
  return data.access_token;
}

async function fetchCol(name, token, pageSize = 1000) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${name}?pageSize=${pageSize}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.documents || [];
}

function docToObj(doc) {
  const f = doc.fields || {};
  const out = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(f)) {
    if      ('stringValue'    in v) out[k] = v.stringValue;
    else if ('integerValue'   in v) out[k] = Number(v.integerValue);
    else if ('doubleValue'    in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue'   in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('nullValue'      in v) out[k] = null;
    // nested maps / arrays not needed for this endpoint
  }
  return out;
}

export default async function handler(request) {
  try {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ records:[], roster:{}, fundraiserEntries:[] }), {
      headers: { 'Content-Type': 'application/json' },
    });

    const sa = JSON.parse(saJson);
    const token = await getAccessToken(sa);

    const [recDocs, rosterDocs, fundraiserDocs] = await Promise.all([
      fetchCol('cadetChallengeRecords', token),
      fetchCol('roster', token),
      fetchCol('fundraiserEntries', token),
    ]);

    const records = recDocs.map(docToObj);
    const roster  = Object.fromEntries(rosterDocs.map(d => {
      const obj = docToObj(d);
      return [obj.id, obj];
    }));
    const fundraiserEntries = fundraiserDocs.map(docToObj);

    return new Response(JSON.stringify({ records, roster, fundraiserEntries }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('leaderboard.json error:', err);
    return new Response(JSON.stringify({ records:[], roster:{}, fundraiserEntries:[] }), {
      status: 200, // return empty gracefully rather than 500
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
