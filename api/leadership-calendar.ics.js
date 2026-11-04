// GET /api/leadership-calendar.ics?t=TOKEN
//
// Private leadership calendar feed — includes both public events (events collection)
// and private leadership events (leadershipCalendar collection).
// Only accessible with the correct LEADERSHIP_CAL_TOKEN query parameter.
//
// Runs as a Vercel Edge Function.
// Uses a Firebase service account (FIREBASE_SERVICE_ACCOUNT env var) to bypass
// Firestore security rules for the private leadershipCalendar collection.

export const config = { runtime: 'edge' };

const PROJECT_ID = 'pbhs-jrotc-web';

const icsEsc = (s = '') =>
  String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');

const icsFold = (line) => {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
  return chunks.join('\r\n');
};

// Sign a JWT with RS256 using Web Crypto API (works in edge runtime)
async function signJWT(payload, privateKeyPem) {
  const b64url = obj =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const sigInput = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}`;
  const pemBody = privateKeyPem.replace(/-----[\w ]+-----|[\r\n]/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput)
  );
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${sigInput}.${sig64}`;
}

// Exchange a service-account JWT for a Google OAuth2 access token
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }, sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

function parseDoc(doc) {
  const f = doc.fields || {};
  const str  = k => f[k]?.stringValue  ?? '';
  const bool = k => f[k]?.booleanValue ?? false;
  return {
    id:          doc.name.split('/').pop(),
    title:       str('title'),
    date:        str('date'),
    endDate:     str('endDate'),
    type:        str('type'),
    location:    str('location'),
    time:        str('time'),
    description: str('description'),
    _priv:       bool('isPrivate'),
  };
}

async function fetchCol(name, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${name}?pageSize=500&orderBy=date`;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.documents || []).map(parseDoc).filter(e => e.date);
}

export default async function handler(request) {
  // Require secret token in ?t= query param
  const url      = new URL(request.url);
  const provided = url.searchParams.get('t') || '';
  const expected = process.env.LEADERSHIP_CAL_TOKEN || '';
  if (!expected || provided !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!saJson) {
      return new Response('Calendar feed not configured — set FIREBASE_SERVICE_ACCOUNT', { status: 503 });
    }
    const sa = JSON.parse(saJson);
    const accessToken = await getAccessToken(sa);

    // Fetch public events (no auth) and private leadership events (service account) in parallel
    const [pubDocs, privDocs] = await Promise.all([
      fetchCol('events', null),
      fetchCol('leadershipCalendar', accessToken),
    ]);

    const all = [
      ...pubDocs.map(e  => ({ ...e, _priv: false })),
      ...privDocs.map(e => ({ ...e, _priv: true  })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PBHS JROTC//Leadership Calendar//EN',
      'X-WR-CALNAME:PBHS JROTC \u2014 Leadership Calendar',
      'X-WR-CALDESC:Leadership calendar \u2014 public + command-level events',
      'X-WR-TIMEZONE:America/New_York',
      'X-WR-RELCALID:pbhsjrotc-leadership-calendar',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'X-PUBLISHED-TTL:PT6H',
    ];

    for (const ev of all) {
      const endStr = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
      const [ey, em, ed] = endStr.split('-').map(Number);
      const nd = new Date(ey, em - 1, ed + 1);
      const dtend = `${nd.getFullYear()}${String(nd.getMonth()+1).padStart(2,'0')}${String(nd.getDate()).padStart(2,'0')}`;

      const desc = [];
      if (ev._priv)        desc.push('[LEADERSHIP]');
      if (ev.type)         desc.push(`Category: ${ev.type}`);
      if (ev.time)         desc.push(`Time: ${ev.time}`);
      if (ev.description)  desc.push(ev.description);

      lines.push('BEGIN:VEVENT');
      lines.push(icsFold(`UID:ldr-${ev.id}@pbhsjrotc.com`));
      lines.push(icsFold(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g,'')}`));
      lines.push(icsFold(`DTEND;VALUE=DATE:${dtend}`));
      lines.push(icsFold(`SUMMARY:${ev._priv ? '\uD83D\uDD12 ' : ''}${icsEsc(ev.title)}`));
      if (ev.location)   lines.push(icsFold(`LOCATION:${icsEsc(ev.location)}`));
      if (desc.length)   lines.push(icsFold(`DESCRIPTION:${icsEsc(desc.join(' | '))}`));
      if (ev.type)       lines.push(icsFold(`CATEGORIES:${icsEsc(ev.type)}`));
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    return new Response(lines.join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="pbhs-jrotc-leadership.ics"',
        'Cache-Control': 'private, max-age=21600',
      },
    });
  } catch (err) {
    console.error('leadership-calendar.ics error:', err);
    return new Response('Internal error', { status: 500 });
  }
}
