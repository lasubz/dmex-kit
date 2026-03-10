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
    // Read rows 3-13 (row 3 = month headers, row 4 = column headers, rows 5+ = data)
    const range = encodeURIComponent('A3:Q15');

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    const rows = data.values || [];

    // Debug: return raw data so we can verify mapping
    if (req.query.debug === '1') {
      return res.status(200).json({ raw: rows.slice(0, 5) });
    }

    // Row 0 = sub-headers with "XX jours ouvrés"
    // Row 1 = main headers: LOT | Ressource | Taux remisé | serial_date | serial_date | ...
    const headerRow = rows[1] || [];

    // Find LOT and Ressource columns by label
    let lotCol = -1, nameCol = -1;
    headerRow.forEach(function(cell, idx) {
      const s = String(cell || '').toLowerCase().trim();
      if (s === 'lot') lotCol = idx;
      if (s === 'ressource') nameCol = idx;
    });

    // Find month columns: detect serial date numbers (> 40000)
    // Convert Excel serial dates to M/YYYY format
    const monthCols = [];
    const months = [];
    headerRow.forEach(function(cell, idx) {
      if (typeof cell === 'number' && cell > 40000) {
        // Excel serial date → JS date (Excel epoch = Dec 30, 1899)
        const date = new Date(Date.UTC(1899, 11, 30 + cell));
        const m = (date.getUTCMonth() + 1) + '/' + date.getUTCFullYear();
        monthCols.push(idx);
        months.push(m);
      }
    });

    const designers = [];
    // Data rows start at index 2 (row 5 in sheet)
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const lot = lotCol >= 0 ? String(row[lotCol] || '').trim() : '';
      const name = nameCol >= 0 ? String(row[nameCol] || '').trim() : '';
      if (!name || /PROD|BUDGET|Consommé|Delta/i.test(name) || /PROD|BUDGET|Consommé|Delta/i.test(lot)) continue;

      const availability = {};
      monthCols.forEach(function(colIdx, mi) {
        const val = row[colIdx];
        availability[months[mi]] = typeof val === 'number' ? val : (val ? parseFloat(String(val).replace(',', '.')) : 0);
      });

      designers.push({ lot: lot, name: name, availability: availability });
    }

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
