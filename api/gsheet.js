import crypto from 'crypto';

// Google Sheets API via service account JWT — zero npm dependencies
export default async function handler(req, res) {
  const { GOOGLE_SA_KEY } = process.env;
  if (!GOOGLE_SA_KEY) {
    return res.status(500).json({ error: 'Google credentials not configured' });
  }

  try {
    const sa = JSON.parse(Buffer.from(GOOGLE_SA_KEY, 'base64').toString('utf-8'));
    const token = await getAccessToken(sa);

    // Spreadsheet ID from the URL
    const spreadsheetId = '1ab-LP89C9UDSXLeGsdnkJwSaMtzwIRQ9vz209xh6ZyA';
    // Read the full data range (skip budget rows, just get designer rows)
    const range = encodeURIComponent('A5:N13');

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    const rows = data.values || [];

    // Parse into structured data (skip Taux column = index 2)
    const months = ['1/2026','2/2026','3/2026','4/2026','5/2026','6/2026','7/2026','8/2026','9/2026','10/2026','11/2026','12/2026'];
    const designers = [];

    rows.forEach(function(row) {
      if (!row[0] && !row[1]) return; // skip empty
      const lot = (row[0] || '').trim();
      const name = (row[1] || '').trim();
      if (!name || name === 'PROD Mois') return; // skip aggregate rows

      const availability = {};
      months.forEach(function(m, i) {
        const val = row[i + 3]; // columns D onwards (index 3+)
        availability[m] = val ? parseFloat(String(val).replace(',', '.')) : 0;
      });

      designers.push({ lot: lot, name: name, availability: availability });
    });

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
    return res.status(200).json({ months: months, designers: designers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── JWT auth for Google APIs (no npm deps) ──────────────
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(claim))
  ];
  const signingInput = segments.join('.');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key);
  segments.push(base64url(signature));

  const jwt = segments.join('.');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error('Google auth failed: ' + text);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
