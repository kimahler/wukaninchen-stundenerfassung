import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const EINTRAEGE_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';
const AUSWERTUNGEN_PATH = EINTRAEGE_PATH + 'Auswertungen/';
const STAMMDATEN_FILENAME = 'Mitarbeiter_Stammdaten.json';

// Dateiname für Stundeneinträge
function getEintraegeFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Stundeneintraege_${year}_${month}.json`;
}

// Dateiname für Excel-Auswertung
function getAuswertungFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Stundenauswertung_${year}_${month}.xlsx`;
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
      return { eintraege: {}, approvals: {}, submissions: {}, zusatzzeiten: {} };
    }

    if (!response.ok) {
      throw new Error(`Nextcloud error: ${response.status}`);
    }

    const text = await response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Fehler beim Laden der Einträge:', error);
    return { eintraege: {}, approvals: {}, submissions: {}, zusatzzeiten: {} };
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

// Stammdaten laden
async function loadStammdaten() {
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${EINTRAEGE_PATH}${encodeURIComponent('Mitarbeiter_Stammdaten.json')}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': getAuthHeader() },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Fehler beim Laden der Stammdaten:', error);
    return null;
  }
}

// Dienstplan laden
async function loadDienstplan() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const filename = `Dienstplan ${year}_${month}.ods`;
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${EINTRAEGE_PATH}${encodeURIComponent(filename)}`;

  try {
    // Lade Stammdaten für bekannte Mitarbeiternamen
    const stammdaten = await loadStammdaten();

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': getAuthHeader() },
    });

    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    return parseDienstplanForExport(buffer, stammdaten);
  } catch (error) {
    console.error('Fehler beim Laden des Dienstplans:', error);
    return null;
  }
}

// Vereinfachter Dienstplan-Parser für Export
function parseDienstplanForExport(buffer, stammdaten = null) {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Bekannte Mitarbeiter aus Stammdaten oder Fallback
  let bekannteNamen;
  if (stammdaten && stammdaten.mitarbeiter) {
    bekannteNamen = Object.keys(stammdaten.mitarbeiter).filter(name =>
      stammdaten.mitarbeiter[name].active !== false
    );
  } else {
    bekannteNamen = ['Ilai', 'Edu', 'Juli', 'Lucia', 'Myriam', 'Alina', 'Berit', 'Catharina', 'Izabella', 'Olli'];
  }
  const wochen = [];

  workbook.SheetNames.forEach((sheetName) => {
    if (!sheetName.startsWith('KW')) return;

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const headerRow = data[0] || [];
    const datumMatch = String(headerRow[0] || '').match(/(\d{2}\.\d{2}\.?\s*[-–]\s*\d{2}\.\d{2}\.?\d{0,4})/);
    const zeitraum = datumMatch ? datumMatch[1] : sheetName;

    // Parse dates
    let wochenDaten = ['', '', '', '', ''];
    const startMatch = zeitraum.match(/(\d{2})\.(\d{2})\.?(\d{2,4})?/);
    if (startMatch) {
      const startDay = parseInt(startMatch[1], 10);
      const startMonth = parseInt(startMatch[2], 10);
      const year = startMatch[3] ? (startMatch[3].length === 2 ? 2000 + parseInt(startMatch[3], 10) : parseInt(startMatch[3], 10)) : new Date().getFullYear();

      for (let i = 0; i < 5; i++) {
        const date = new Date(year, startMonth - 1, startDay + i);
        wochenDaten[i] = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
      }
    }

    const woche = { name: sheetName, zeitraum, tage: {}, daten: wochenDaten };

    const wochentage = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
    const tagSpalten = [1, 5, 9, 13, 17];

    data.forEach((row) => {
      const name = String(row[0] || '').trim();
      if (!bekannteNamen.includes(name)) return;

      const tage = [];
      wochentage.forEach((tagName, tagIdx) => {
        const colStart = tagSpalten[tagIdx];
        const tagDatum = wochenDaten[tagIdx] || '';

        if (colStart === undefined || colStart >= row.length) {
          tage.push({ tag: tagName, datum: tagDatum, von: null, bis: null, sollStd: 0 });
          return;
        }

        const vonRaw = row[colStart];
        const bisRaw = row[colStart + 1];
        const stdRaw = row[colStart + 2];

        const vonStr = String(vonRaw || '').trim().toUpperCase();
        if (['K', 'U', 'KS', 'KK', 'S', 'F'].includes(vonStr)) {
          let geplanteSollStd = 0;
          if (stdRaw) {
            geplanteSollStd = typeof stdRaw === 'number' ? stdRaw : parseFloat(String(stdRaw).replace(',', '.')) || 0;
          }
          tage.push({ tag: tagName, datum: tagDatum, von: null, bis: null, sollStd: geplanteSollStd, status: vonStr });
          return;
        }

        let von = null, bis = null, sollStd = 0;

        if (vonRaw) {
          if (typeof vonRaw === 'number') {
            const hours = Math.floor(vonRaw * 24);
            const mins = Math.round((vonRaw * 24 - hours) * 60);
            von = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          } else {
            von = String(vonRaw).replace(/:\d{2}$/, '');
          }
        }

        if (bisRaw) {
          if (typeof bisRaw === 'number') {
            const hours = Math.floor(bisRaw * 24);
            const mins = Math.round((bisRaw * 24 - hours) * 60);
            bis = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          } else {
            bis = String(bisRaw).replace(/:\d{2}$/, '');
          }
        }

        if (stdRaw) {
          sollStd = typeof stdRaw === 'number' ? stdRaw : parseFloat(String(stdRaw).replace(',', '.')) || 0;
        }

        tage.push({ tag: tagName, datum: tagDatum, von, bis, sollStd });
      });

      woche.tage[name] = tage;
    });

    wochen.push(woche);
  });

  return wochen;
}

// Pausenabzug berechnen
function berechnePausenabzug(istStunden, isMinor = false) {
  const grenze = isMinor ? 4.5 : 6;
  return istStunden > grenze ? 0.5 : 0;
}

// Ordner erstellen falls nicht vorhanden
async function ensureFolderExists(path) {
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${path}`;

  try {
    // Check if folder exists
    const checkResponse = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Authorization': getAuthHeader(),
        'Depth': '0',
      },
    });

    if (checkResponse.status === 404) {
      // Create folder
      const createResponse = await fetch(url, {
        method: 'MKCOL',
        headers: { 'Authorization': getAuthHeader() },
      });

      if (!createResponse.ok && createResponse.status !== 201) {
        console.error('Fehler beim Erstellen des Ordners:', createResponse.status);
      }
    }
  } catch (error) {
    console.error('Fehler bei Ordnerprüfung:', error);
  }
}

// Excel-Auswertung generieren und speichern
async function generateAndSaveExcel(data, stammdaten, dienstplan) {
  try {
    const now = new Date();
    const monatKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monatName = now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

    // Get active employees
    const mitarbeiter = stammdaten?.mitarbeiter
      ? Object.values(stammdaten.mitarbeiter).filter(m => m.active !== false)
      : [];

    if (mitarbeiter.length === 0) {
      console.log('Keine Mitarbeiter für Excel-Export gefunden');
      return;
    }

    const workbook = XLSX.utils.book_new();

    // === ÜBERSICHT SHEET ===
    const uebersichtData = [];

    // Header with timestamp
    const approvedCount = mitarbeiter.filter(ma =>
      data.approvals?.[`${ma.name}-${monatKey}`]?.status === 'genehmigt'
    ).length;

    uebersichtData.push([`Stundenauswertung ${monatName}`]);
    uebersichtData.push([`Stand: ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} | ${approvedCount}/${mitarbeiter.length} genehmigt`]);
    uebersichtData.push([]); // Empty row

    // Column headers
    uebersichtData.push(['Name', 'Bereich', 'Soll-Std', 'Arbeitszeit', 'Vorbereitung', 'Büro', 'Gesamt', 'Differenz', 'Status']);

    // Calculate hours for each employee
    mitarbeiter.forEach(ma => {
      let sollGesamt = 0;
      let istGesamt = 0;

      // Calculate from dienstplan
      if (dienstplan) {
        dienstplan.forEach((woche, wochenIdx) => {
          const maTage = woche.tage?.[ma.name] || [];
          maTage.forEach((tag, tagIdx) => {
            if (tag.sollStd > 0) {
              sollGesamt += tag.sollStd;
              const key = `${ma.name}-${wochenIdx}-${tagIdx}`;
              const eintrag = data.eintraege?.[key]?.value;

              const istDienstplanAbwesend = ['K', 'U', 'KK', 'F', 'S', 'KS'].includes(tag.status);

              if (istDienstplanAbwesend) {
                istGesamt += tag.sollStd;
              } else if (['K', 'U', 'KK', 'F'].includes(eintrag)) {
                istGesamt += tag.sollStd;
              } else {
                let tagesStd = tag.sollStd;
                if (eintrag && eintrag !== '0') {
                  tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
                }
                const pause = berechnePausenabzug(tagesStd, ma.isMinor);
                istGesamt += tagesStd - pause;
              }
            }
          });
        });
      }

      // Zusatzzeiten
      const zusatzKey = `${ma.name}-${monatKey}`;
      const maZusatz = data.zusatzzeiten?.[zusatzKey] || {};
      const vorbereitungTotal = (maZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
      const buerozeitTotal = (maZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);
      const gesamt = istGesamt + vorbereitungTotal + buerozeitTotal;
      const differenz = gesamt - sollGesamt;

      // Status
      let status = 'Offen';
      const approval = data.approvals?.[`${ma.name}-${monatKey}`];
      const submission = data.submissions?.[`${ma.name}-${monatKey}`];
      if (approval?.status === 'genehmigt') status = '✓ Genehmigt';
      else if (approval?.status === 'abgelehnt') status = '✗ Abgelehnt';
      else if (submission?.status === 'eingereicht') status = '◐ Eingereicht';

      // Bereich display
      const bereichDisplay = ma.bereich === 'Ü3' ? 'Wald' : ma.bereich;

      uebersichtData.push([
        ma.name,
        bereichDisplay,
        sollGesamt,
        istGesamt,
        vorbereitungTotal || '-',
        buerozeitTotal || '-',
        gesamt,
        differenz,
        status
      ]);
    });

    const uebersichtSheet = XLSX.utils.aoa_to_sheet(uebersichtData);

    // Set column widths
    uebersichtSheet['!cols'] = [
      { wch: 12 }, // Name
      { wch: 8 },  // Bereich
      { wch: 10 }, // Soll-Std
      { wch: 11 }, // Arbeitszeit
      { wch: 12 }, // Vorbereitung
      { wch: 8 },  // Büro
      { wch: 10 }, // Gesamt
      { wch: 10 }, // Differenz
      { wch: 14 }, // Status
    ];

    XLSX.utils.book_append_sheet(workbook, uebersichtSheet, 'Übersicht');

    // === INDIVIDUAL EMPLOYEE SHEETS ===
    mitarbeiter.forEach(ma => {
      const sheetData = [];
      sheetData.push([`${ma.name} - ${monatName}`]);
      sheetData.push([]);
      sheetData.push(['Woche', 'Tag', 'Datum', 'Soll', 'Ist', 'Abweichung', 'Pause', 'Bemerkung']);

      let maGesamt = { soll: 0, ist: 0, pause: 0 };

      if (dienstplan) {
        dienstplan.forEach((woche, wochenIdx) => {
          const maTage = woche.tage?.[ma.name] || [];

          maTage.forEach((tag, tagIdx) => {
            const key = `${ma.name}-${wochenIdx}-${tagIdx}`;
            const eintrag = data.eintraege?.[key]?.value;

            let istStd = 0;
            let abweichung = '-';
            let pauseAbzug = 0;
            let bemerkung = '';

            const istDienstplanAbwesend = ['K', 'U', 'KK', 'F', 'S', 'KS'].includes(tag.status);

            if (tag.sollStd === 0 && !istDienstplanAbwesend) {
              bemerkung = 'Kein Dienst';
              istStd = 0;
            } else if (istDienstplanAbwesend) {
              istStd = tag.sollStd;
              bemerkung = tag.status === 'K' ? 'Krank' :
                         tag.status === 'U' ? 'Urlaub' :
                         tag.status === 'KK' ? 'Kind krank' :
                         tag.status === 'F' ? 'Fortbildung' :
                         tag.status === 'S' ? 'Seminar' : tag.status;
            } else if (['K', 'U', 'KK', 'F'].includes(eintrag)) {
              istStd = tag.sollStd;
              bemerkung = eintrag === 'K' ? 'Krank' :
                         eintrag === 'U' ? 'Urlaub' :
                         eintrag === 'KK' ? 'Kind krank' :
                         eintrag === 'F' ? 'Fortbildung' : eintrag;
            } else {
              let tagesStd = tag.sollStd;
              if (eintrag && eintrag !== '0') {
                const numValue = parseFloat(eintrag) || 0;
                tagesStd = tag.sollStd + numValue;
                abweichung = numValue > 0 ? `+${numValue}` : numValue.toString();
              } else {
                abweichung = '0';
              }
              pauseAbzug = berechnePausenabzug(tagesStd, ma.isMinor);
              istStd = tagesStd - pauseAbzug;
            }

            maGesamt.soll += tag.sollStd;
            maGesamt.ist += istStd;
            maGesamt.pause += pauseAbzug;

            sheetData.push([
              woche.name,
              tag.tag,
              tag.datum,
              tag.sollStd || '-',
              istStd || '-',
              abweichung,
              pauseAbzug || '-',
              bemerkung
            ]);
          });

          // Add empty row between weeks
          sheetData.push([]);
        });
      }

      // Summary rows
      sheetData.push([]);
      sheetData.push(['', '', 'SUMME', maGesamt.soll, maGesamt.ist, '', maGesamt.pause, '']);

      // Zusatzzeiten
      const zusatzKey = `${ma.name}-${monatKey}`;
      const maZusatz = data.zusatzzeiten?.[zusatzKey] || {};
      const vorbereitungTotal = (maZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
      const buerozeitTotal = (maZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);

      if (vorbereitungTotal > 0) {
        sheetData.push(['', '', 'Vorbereitung', '', vorbereitungTotal, '', '', '']);
      }
      if (buerozeitTotal > 0) {
        sheetData.push(['', '', 'Bürozeit', '', buerozeitTotal, '', '', '']);
      }

      const gesamtMitZusatz = maGesamt.ist + vorbereitungTotal + buerozeitTotal;
      sheetData.push(['', '', 'GESAMT', maGesamt.soll, gesamtMitZusatz, '', '', '']);

      const maSheet = XLSX.utils.aoa_to_sheet(sheetData);
      maSheet['!cols'] = [
        { wch: 8 },  // Woche
        { wch: 5 },  // Tag
        { wch: 8 },  // Datum
        { wch: 6 },  // Soll
        { wch: 6 },  // Ist
        { wch: 10 }, // Abweichung
        { wch: 6 },  // Pause
        { wch: 15 }, // Bemerkung
      ];

      XLSX.utils.book_append_sheet(workbook, maSheet, ma.name);
    });

    // Generate Excel buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Ensure Auswertungen folder exists
    await ensureFolderExists(AUSWERTUNGEN_PATH);

    // Save to Nextcloud
    const filename = getAuswertungFilename();
    const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${AUSWERTUNGEN_PATH}${encodeURIComponent(filename)}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: excelBuffer,
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      console.error('Excel save error:', response.status);
    } else {
      console.log('Excel-Auswertung gespeichert:', filename);
    }

  } catch (error) {
    console.error('Fehler beim Generieren der Excel-Auswertung:', error);
    // Don't throw - Excel generation should not break saving
  }
}

// GET: Einträge laden
export async function GET() {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({
        eintraege: {},
        approvals: {},
        submissions: {},
        zusatzzeiten: {},
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
      return NextResponse.json({
        success: true,
        message: 'Demo-Modus: Einträge werden nicht gespeichert',
        demo: true
      });
    }

    const body = await request.json();
    const { mitarbeiter, eintraege: neueEintraege, zusatzzeiten: neueZusatzzeiten } = body;

    if (!mitarbeiter) {
      return NextResponse.json(
        { error: 'Mitarbeiter erforderlich' },
        { status: 400 }
      );
    }

    // Bestehende Daten laden
    const data = await loadFromNextcloud();

    // Neue Einträge für diesen Mitarbeiter zusammenführen
    if (neueEintraege) {
      Object.keys(neueEintraege).forEach(key => {
        if (key.startsWith(mitarbeiter + '-')) {
          data.eintraege[key] = {
            value: neueEintraege[key],
            timestamp: new Date().toISOString(),
            mitarbeiter: mitarbeiter
          };
        }
      });
    }

    // Zusatzzeiten für diesen Mitarbeiter zusammenführen
    if (neueZusatzzeiten) {
      if (!data.zusatzzeiten) data.zusatzzeiten = {};
      Object.keys(neueZusatzzeiten).forEach(key => {
        if (key.startsWith(mitarbeiter + '-')) {
          data.zusatzzeiten[key] = neueZusatzzeiten[key];
        }
      });
    }

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

    // Excel-Auswertung generieren (async, non-blocking)
    const [stammdaten, dienstplan] = await Promise.all([
      loadStammdaten(),
      loadDienstplan()
    ]);
    await generateAndSaveExcel(data, stammdaten, dienstplan);

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
      status: status,
      kommentar: kommentar || '',
      timestamp: new Date().toISOString(),
      genehmiger: 'Leitung'
    };

    // Auf Nextcloud speichern
    await saveToNextcloud(data);

    // Excel-Auswertung aktualisieren
    const [stammdaten, dienstplan] = await Promise.all([
      loadStammdaten(),
      loadDienstplan()
    ]);
    await generateAndSaveExcel(data, stammdaten, dienstplan);

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
