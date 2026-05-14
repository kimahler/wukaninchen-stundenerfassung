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
    const tageRes = await ncGet(`${BASE}/betriebszustand_tage.json`);
    const tage = await tageRes.json();

    let annotations = [];
    try {
      const annRes = await ncGet(`${BASE}/manuelle_annotationen.json`);
      annotations = await annRes.json();
    } catch (e) {
      if (e.status !== 404) console.warn('Annotationen nicht geladen:', e.message);
    }

    // Annotationen auf wald/haus-Felder anwenden
    for (const ann of annotations) {
      if (!tage[ann.datum]) continue;
      // Rückwärts-Kompatibilität: kein kita-Feld → beide
      const kitas = (!ann.kita || ann.kita === 'beide') ? ['wald', 'haus'] : [ann.kita];
      for (const k of kitas) {
        if (!tage[ann.datum][k]) continue;
        if (ann.zustand)                       tage[ann.datum][k].zustand     = ann.zustand;
        if (ann.kommentar)                     tage[ann.datum][k].begruendung = ann.kommentar;
        if (ann.spaetbetreuung_ausgefallen && k === 'haus') {
          tage[ann.datum][k].spaetbetreuung_ausgefallen = true;
        }
        tage[ann.datum][k].verifiziert = true;
      }
    }

    // Nur Tage bis heute zurückgeben
    const today = new Date().toISOString().slice(0, 10);
    const gefiltert = {};
    for (const [date, value] of Object.entries(tage)) {
      if (date <= today) gefiltert[date] = value;
    }

    const res = NextResponse.json({ tage: gefiltert });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    console.error('Ausfallanalyse data error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
