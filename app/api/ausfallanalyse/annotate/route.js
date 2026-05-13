import { NextResponse } from 'next/server';

const NC_URL  = process.env.NEXTCLOUD_URL  || 'https://cloud.wukaninchen.net';
const NC_USER = process.env.NEXTCLOUD_USER || '';
const NC_PASS = process.env.NEXTCLOUD_PASS || '';
const BASE    = process.env.ANALYSE_NEXTCLOUD_PATH || '/03 Kinderbetreuung/Pädagogik/Ausfallsicherheit';
const ANN_PATH = `${BASE}/manuelle_annotationen.json`;

function ncUrl(path) {
  return (
    `${NC_URL}/remote.php/dav/files/${NC_USER}` +
    path.split('/').map(s => encodeURIComponent(s)).join('/')
  );
}

function ncAuth() {
  return 'Basic ' + Buffer.from(`${NC_USER}:${NC_PASS}`).toString('base64');
}

async function readAnnotations() {
  const res = await fetch(ncUrl(ANN_PATH), {
    headers: { Authorization: ncAuth() },
    cache: 'no-store',
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Nextcloud ${res.status}`);
  return res.json();
}

async function writeAnnotations(data) {
  const res = await fetch(ncUrl(ANN_PATH), {
    method: 'PUT',
    headers: { Authorization: ncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!res.ok) throw new Error(`Nextcloud PUT ${res.status}`);
}

export async function GET() {
  try {
    return NextResponse.json(await readAnnotations());
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { datum, zustand, spaetbetreuung_ausgefallen, kommentar } = body;

    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      return NextResponse.json({ error: 'Ungültiges Datum' }, { status: 400 });
    }

    const list = await readAnnotations();
    const idx  = list.findIndex(a => a.datum === datum);
    const entry = {
      datum,
      zustand:                  zustand || null,
      spaetbetreuung_ausgefallen: spaetbetreuung_ausgefallen || false,
      kommentar:                kommentar || '',
    };

    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
      list.sort((a, b) => a.datum.localeCompare(b.datum));
    }

    // Leere Einträge entfernen
    const clean = list.filter(a => a.zustand || a.spaetbetreuung_ausgefallen || a.kommentar);
    await writeAnnotations(clean);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
