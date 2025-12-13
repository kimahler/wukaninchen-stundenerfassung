import { NextResponse } from 'next/server';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const EINTRAEGE_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';

// Dateiname für Stundeneinträge
function getEintraegeFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Stundeneintraege_${year}_${month}.json`;
}

// Auth-Header erstellen
function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASS}`).toString('base64');
}

// Einträge von Nextcloud laden
async function loadFromNextcloud() {
  const filename = getEintraegeFilename();
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${EINTRAEGE_PATH}${encodeURIComponent(filename)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
      },
    });

    if (response.status === 404) {
      // Datei existiert noch nicht - das ist OK
      return { eintraege: {}, approvals: {} };
    }

    if (!response.ok) {
      throw new Error(`Nextcloud error: ${response.status}`);
    }

    const text = await response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Fehler beim Laden der Einträge:', error);
    return { eintraege: {}, approvals: {} };
  }
}

// Einträge auf Nextcloud speichern
async function saveToNextcloud(data) {
  const filename = getEintraegeFilename();
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${EINTRAEGE_PATH}${encodeURIComponent(filename)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data, null, 2),
  });

  if (!response.ok && response.status !== 201 && response.status !== 204) {
    throw new Error(`Nextcloud save error: ${response.status}`);
  }

  return true;
}

// GET: Einträge laden
export async function GET() {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      // Demo-Modus: Leere Einträge zurückgeben
      return NextResponse.json({
        eintraege: {},
        approvals: {},
        demo: true
      });
    }

    const data = await loadFromNextcloud();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Fehler beim Laden:', error);
    return NextResponse.json(
      { error: 'Einträge konnten nicht geladen werden', eintraege: {}, approvals: {} },
      { status: 500 }
    );
  }
}

// POST: Einträge speichern
export async function POST(request) {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      // Demo-Modus: Erfolg simulieren
      return NextResponse.json({
        success: true,
        message: 'Demo-Modus: Einträge werden nicht gespeichert',
        demo: true
      });
    }

    const body = await request.json();
    const { mitarbeiter, eintraege: neueEintraege } = body;

    if (!mitarbeiter || !neueEintraege) {
      return NextResponse.json(
        { error: 'Mitarbeiter und Einträge erforderlich' },
        { status: 400 }
      );
    }

    // Bestehende Daten laden
    const data = await loadFromNextcloud();

    // Neue Einträge für diesen Mitarbeiter zusammenführen
    Object.keys(neueEintraege).forEach(key => {
      // Key-Format: "Name-WochenIndex-TagIndex"
      if (key.startsWith(mitarbeiter + '-')) {
        data.eintraege[key] = {
          value: neueEintraege[key],
          timestamp: new Date().toISOString(),
          mitarbeiter: mitarbeiter
        };
      }
    });

    // Submission-Status setzen
    const now = new Date();
    const monatKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!data.submissions) data.submissions = {};
    data.submissions[`${mitarbeiter}-${monatKey}`] = {
      status: 'eingereicht',
      timestamp: new Date().toISOString()
    };

    // Auf Nextcloud speichern
    await saveToNextcloud(data);

    return NextResponse.json({
      success: true,
      message: 'Einträge gespeichert',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fehler beim Speichern:', error);
    return NextResponse.json(
      { error: 'Einträge konnten nicht gespeichert werden: ' + error.message },
      { status: 500 }
    );
  }
}

// PUT: Genehmigung durch Admin
export async function PUT(request) {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({
        success: true,
        message: 'Demo-Modus',
        demo: true
      });
    }

    const body = await request.json();
    const { mitarbeiter, monat, status, kommentar } = body;

    if (!mitarbeiter || !monat || !status) {
      return NextResponse.json(
        { error: 'Mitarbeiter, Monat und Status erforderlich' },
        { status: 400 }
      );
    }

    // Bestehende Daten laden
    const data = await loadFromNextcloud();

    // Genehmigungsstatus setzen
    if (!data.approvals) data.approvals = {};
    data.approvals[`${mitarbeiter}-${monat}`] = {
      status: status, // 'genehmigt', 'abgelehnt', 'korrektur_erforderlich'
      kommentar: kommentar || '',
      timestamp: new Date().toISOString(),
      genehmiger: 'Leitung'
    };

    // Auf Nextcloud speichern
    await saveToNextcloud(data);

    return NextResponse.json({
      success: true,
      message: `Status auf "${status}" gesetzt`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fehler bei Genehmigung:', error);
    return NextResponse.json(
      { error: 'Genehmigung konnte nicht gespeichert werden: ' + error.message },
      { status: 500 }
    );
  }
}
