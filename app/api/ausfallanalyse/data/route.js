import { NextResponse } from 'next/server';

const NC_URL  = process.env.NEXTCLOUD_URL  || 'https://cloud.wukaninchen.net';
const NC_USER = process.env.NEXTCLOUD_USER || '';
const NC_PASS = process.env.NEXTCLOUD_PASS || '';
const BASE    = process.env.ANALYSE_NEXTCLOUD_PATH || '/03 Kinderbetreuung/Pädagogik/Ausfallsicherheit';

function ncUrl(path) {
  return (
    `${NC_URL}/remote.php/dav/files/${NC_USER}` +
    path.split('/').map(s => encodeURIComponent(s)).join('/')
  );
}

function ncAuth() {
  return 'Basic ' + Buffer.from(`${NC_USER}:${NC_PASS}`).toString('base64');
}

async function ncGet(path) {
  const res = await fetch(ncUrl(path), {
    headers: { Authorization: ncAuth() },
    cache: 'no-store',
  });
  if (!res.ok) throw Object.assign(new Error(`Nextcloud ${res.status}`), { status: res.status });
  return res;
}

export async function GET() {
  try {
    // Betriebszustand-Tage (generiert von GitHub Action)
    const tageRes = await ncGet(`${BASE}/betriebszustand_tage.json`);
    const tage = await tageRes.json();

    // Annotationen (live, editierbar via /annotate)
    let annotations = [];
    try {
      const annRes = await ncGet(`${BASE}/manuelle_annotationen.json`);
      annotations = await annRes.json();
    } catch (e) {
      if (e.status !== 404) console.warn('Annotationen nicht geladen:', e.message);
    }

    // Annotationen auf tage.json anwenden (für frisch hinzugefügte Einträge)
    for (const ann of annotations) {
      if (!tage[ann.datum]) continue;
      if (ann.zustand)                       tage[ann.datum].zustand     = ann.zustand;
      if (ann.kommentar)                     tage[ann.datum].begruendung = ann.kommentar;
      if (ann.spaetbetreuung_ausgefallen)    tage[ann.datum].spaetbetreuung_ausgefallen = true;
    }

    const res = NextResponse.json({ tage });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    console.error('Ausfallanalyse data error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
