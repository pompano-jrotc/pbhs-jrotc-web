// GET /api/calendar.ics
//
// Returns the public PBHS JROTC events calendar in iCalendar (.ics) format.
// Clients (iPhone Calendar, Google Calendar, Outlook) can subscribe via:
//   webcal://www.pbhsjrotc.com/api/calendar.ics
//
// Runs as a Vercel Edge Function (doesn't count against the 12 serverless limit).
// The events collection has allow read: if true so no auth is needed.
// Reads via the Firestore REST API.

export const config = { runtime: 'edge' };

const PROJECT_ID = 'pbhs-jrotc-web';
const EVENTS_PATH = `projects/${PROJECT_ID}/databases/(default)/documents/events`;

// ── Optional service-account auth (fallback when public read is restricted) ───
async function signJWT(payload, privateKeyPem) {
  const b64url = obj =>
    btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const sigInput = `${b64url({ alg:'RS256', typ:'JWT' })}.${b64url(payload)}`;
  const pemBody  = privateKeyPem.replace(/-----[\w ]+-----|[\r\n]/g, '');
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

async function fetchEventDocs(authHeader) {
  const url = `https://firestore.googleapis.com/v1/${EVENTS_PATH}?pageSize=500&orderBy=date`;
  const headers = authHeader ? { Authorization: authHeader } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.documents || [];
}

// Escape iCal text values (commas, semicolons, backslashes, newlines)
const esc = (s = '') =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// YYYY-MM-DD → YYYYMMDD (iCal all-day date)
const toIcalDate = (str) => (str || '').replace(/-/g, '');

// Fold long iCal lines at 75 chars (RFC 5545 §3.1)
const fold = (line) => {
  if (line.length <= 75) return line;
  const chunks = [];
  chunks.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    chunks.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join('\r\n');
};

// Parse a Firestore REST document into a plain object
function parseDoc(doc) {
  const fields = doc.fields || {};
  const get = (key, type) => {
    const f = fields[key];
    if (!f) return '';
    return f[type] ?? f.stringValue ?? '';
  };
  return {
    id:          doc.name.split('/').pop(),
    title:       get('title',       'stringValue'),
    date:        get('date',        'stringValue'),
    endDate:     get('endDate',     'stringValue'),
    type:        get('type',        'stringValue'),
    location:    get('location',    'stringValue'),
    time:        get('time',        'stringValue'),
    description: get('description', 'stringValue'),
  };
}

export default async function handler(request) {
  try {
    // Try unauthenticated first; fall back to service-account auth if rules require it
    let rawDocs = await fetchEventDocs(null);
    if (rawDocs === null) {
      const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!saJson) return new Response('Service account not configured', { status: 503 });
      const sa = JSON.parse(saJson);
      const token = await getAccessToken(sa);
      rawDocs = await fetchEventDocs(`Bearer ${token}`);
      if (rawDocs === null) return new Response('Upstream Firestore error', { status: 502 });
    }
    const docs = rawDocs.map(parseDoc).filter(e => e.date);

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PBHS JROTC//Tornado Battalion//EN',
      'X-WR-CALNAME:PBHS JROTC — Tornado Battalion',
      'X-WR-CALDESC:Official PBHS JROTC Tornado Battalion Events Calendar',
      'X-WR-TIMEZONE:America/New_York',
      'X-WR-RELCALID:pbhsjrotc-public-calendar',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'X-PUBLISHED-TTL:PT6H',
    ];

    for (const ev of docs) {
      // DTEND for all-day events must be the day AFTER the last day
      const endDateStr = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
      const [ey, em, ed] = endDateStr.split('-').map(Number);
      const nextDay = new Date(ey, em - 1, ed + 1);
      const dtend = `${nextDay.getFullYear()}${String(nextDay.getMonth()+1).padStart(2,'0')}${String(nextDay.getDate()).padStart(2,'0')}`;

      const descParts = [];
      if (ev.type)        descParts.push(`Category: ${ev.type}`);
      if (ev.time)        descParts.push(`Time: ${ev.time}`);
      if (ev.description) descParts.push(ev.description);

      lines.push('BEGIN:VEVENT');
      lines.push(fold(`UID:${ev.id}@pbhsjrotc.com`));
      lines.push(fold(`DTSTART;VALUE=DATE:${toIcalDate(ev.date)}`));
      lines.push(fold(`DTEND;VALUE=DATE:${dtend}`));
      lines.push(fold(`SUMMARY:${esc(ev.title)}`));
      if (ev.location)            lines.push(fold(`LOCATION:${esc(ev.location)}`));
      if (descParts.length)       lines.push(fold(`DESCRIPTION:${esc(descParts.join(' | '))}`));
      if (ev.type)                lines.push(fold(`CATEGORIES:${esc(ev.type)}`));
      lines.push(fold(`URL:https://www.pbhsjrotc.com/events`));
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    const body = lines.join('\r\n') + '\r\n';

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="pbhs-jrotc.ics"',
        'Cache-Control': 'public, max-age=21600',
      },
    });
  } catch (err) {
    console.error('calendar.ics error:', err);
    return new Response('Internal error', { status: 500 });
  }
}
