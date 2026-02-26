import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const EINTRAEGE_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';
const AUSWERTUNGEN_PATH = EINTRAEGE_PATH + 'Auswertungen/';
const STAMMDATEN_FILENAME = 'Mitarbeiter_Stammdaten.json';

// C3: Time helpers for Von/Bis Excel export
function parseTime(str) {
  if (!str) return null;
  const match = String(str).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function formatTime(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Helper: Response mit Cache-Control Headers
function jsonResponse(data, status = 200) {
  const response = NextResponse.json(data, { status });
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

// Dateiname für Stundeneinträge
function getEintraegeFilename(monthParam = null) {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [year, month] = monthParam.split('-');
    return `Stundeneintraege_${year}_${month}.json`;
  }
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
async function loadFromNextcloud(monthParam = null) {
  const filename = getEintraegeFilename(monthParam);
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
    const result = parseDienstplanForExport(buffer, stammdaten);
    return result; // { wochen, gesamtStdMap }
  } catch (error) {
    console.error('Fehler beim Laden des Dienstplans:', error);
    return null;
  }
}

// Vereinfachter Dienstplan-Parser für Export
// Returns { wochen, gesamtStdMap } where gesamtStdMap maps name → weekly contract hours from ODS col 25
function parseDienstplanForExport(buffer, stammdaten = null) {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Bekannte Mitarbeiter aus Stammdaten oder Fallback
  let bekannteNamen;
  let stammdatenMap = {};
  if (stammdaten && stammdaten.mitarbeiter) {
    bekannteNamen = Object.keys(stammdaten.mitarbeiter).filter(name =>
      stammdaten.mitarbeiter[name].active !== false
    );
    stammdatenMap = stammdaten.mitarbeiter;
  } else {
    bekannteNamen = ['Ilai', 'Edu', 'Juli', 'Lucia', 'Myriam', 'Alina', 'Berit', 'Catharina', 'Izabella', 'Olli'];
  }
  const wochen = [];
  const gesamtStdMap = {};

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

        let vonStr = String(vonRaw || '').trim().toUpperCase();

        // Phase 2.1: FoBi/Fortbildung normalisieren zu "F"
        if (vonStr === 'FOBI' || vonStr === 'FORTBILDUNG') {
          vonStr = 'F';
        }

        if (['K', 'U', 'KS', 'KK', 'S', 'F'].includes(vonStr)) {
          let geplanteSollStd = 0;
          if (stdRaw) {
            geplanteSollStd = typeof stdRaw === 'number' ? stdRaw : parseFloat(String(stdRaw).replace(',', '.')) || 0;
          }

          // Phase 2.2: Bei Urlaub ohne Stunden → standardStunden aus Stammdaten
          if (vonStr === 'U' && geplanteSollStd === 0) {
            const maStamm = stammdatenMap[name];
            geplanteSollStd = maStamm?.standardStunden || 6; // Fallback 6h
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

      // C1: Gesamtstd. Arbeitszeitnachweis aus Spalte 25 (nur im ersten KW-Sheet)
      if (wochen.length === 0 && row.length > 25) {
        const gesamtStdRaw = row[25];
        if (gesamtStdRaw !== undefined && gesamtStdRaw !== '' && gesamtStdRaw !== null) {
          const gesamtStd = typeof gesamtStdRaw === 'number' ? gesamtStdRaw : parseFloat(String(gesamtStdRaw).replace(',', '.'));
          if (!isNaN(gesamtStd) && gesamtStd > 0) {
            gesamtStdMap[name] = gesamtStd;
          }
        }
      }
    });

    wochen.push(woche);
  });

  return { wochen, gesamtStdMap };
}

// Pausenabzug berechnen
// M1: manualPause = number (von User gesetzt) oder null (Auto)
// Returns { pauseDisplay, pauseAbzug }
// pauseDisplay = was im Excel in der Pause-Spalte steht
// pauseAbzug = was tatsächlich von Ist-Stunden abgezogen wird
function berechnePausenabzug(istStunden, isMinor = false, manualPause = null) {
  const grenze = isMinor ? 4.5 : 6;
  if (manualPause !== null && manualPause !== undefined) {
    // Manuelle Pause: wird wirklich abgezogen
    return { pauseDisplay: manualPause, pauseAbzug: manualPause };
  }
  // Auto-Pause: >6h → 30min dokumentiert, aber NICHT von Ist subtrahiert
  // (Kita-Personal macht faktisch keine Pause, Arbeitszeitnachweis muss es zeigen)
  const autoPause = istStunden > grenze ? 0.5 : 0;
  return { pauseDisplay: autoPause, pauseAbzug: 0 };
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

    // Destructure dienstplan (new format: { wochen, gesamtStdMap })
    const dienstplanWochen = dienstplan?.wochen || dienstplan || [];
    const gesamtStdMap = dienstplan?.gesamtStdMap || {};

    // M3: Vormonat-Saldo laden
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonatKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const prevData = await loadFromNextcloud(prevMonatKey);
    const vormonatSaldoMap = {};

    // Get active employees
    const mitarbeiter = stammdaten?.mitarbeiter
      ? Object.values(stammdaten.mitarbeiter).filter(m => m.active !== false)
      : [];

    if (mitarbeiter.length === 0) {
      console.log('Keine Mitarbeiter für Excel-Export gefunden');
      return;
    }

    // M3: Vormonat-Saldo pro MA berechnen
    if (prevData && prevData.eintraege) {
      mitarbeiter.forEach(ma => {
        let prevSoll = 0;
        let prevIst = 0;
        Object.entries(prevData.eintraege).forEach(([key, entry]) => {
          if (key.startsWith(`${ma.name}-`)) {
            const sollStd = entry.sollStd || 0;
            prevSoll += sollStd;
            const eintrag = entry.value;
            if (["K", "U", "KK", "F", "S", "KS"].includes(eintrag)) {
              prevIst += sollStd;
            } else {
              const abweichung = parseFloat(eintrag) || 0;
              prevIst += sollStd + abweichung;
              // Manuelle Pause vom Vormonat berücksichtigen
              if (entry.pause !== null && entry.pause !== undefined) {
                prevIst -= entry.pause;
              }
            }
          }
        });
        // Vormonat-Zusatzzeiten
        const zusatzKey = `${ma.name}-${prevMonatKey}`;
        const maZusatz = prevData.zusatzzeiten?.[zusatzKey] || {};
        prevIst += (maZusatz.vorbereitung || []).reduce((s, e) => s + e.stunden, 0);
        prevIst += (maZusatz.teamsitzung || []).reduce((s, e) => s + e.stunden, 0);
        prevIst += (maZusatz.buerozeit || []).reduce((s, e) => s + e.stunden, 0);

        if (prevSoll > 0) {
          vormonatSaldoMap[ma.name] = prevIst - prevSoll;
        }
      });
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
    uebersichtData.push(['Name', 'Bereich', 'Vertrag Std/Wo', 'Urlaubstag (Std)', 'Übertrag Vorm.', 'Soll-Std', 'Arbeitszeit', 'Vorbereitung', 'Teamsitzung', 'Büro', 'Gesamt', 'Differenz', 'Status']);

    // Calculate hours for each employee
    mitarbeiter.forEach(ma => {
      let sollGesamt = 0;
      let istGesamt = 0;

      // Calculate from dienstplan
      if (dienstplanWochen.length > 0) {
        dienstplanWochen.forEach((woche, wochenIdx) => {
          const maTage = woche.tage?.[ma.name] || [];
          maTage.forEach((tag, tagIdx) => {
            if (tag.sollStd > 0) {
              sollGesamt += tag.sollStd;
              const key = `${ma.name}-${wochenIdx}-${tagIdx}`;
              const eintrag = data.eintraege?.[key]?.value;

              const istDienstplanAbwesend = ['K', 'U', 'KK', 'F', 'S', 'KS'].includes(tag.status);

              if (istDienstplanAbwesend) {
                istGesamt += tag.sollStd;
              } else if (['K', 'KS', 'U', 'KK', 'F'].includes(eintrag)) {
                istGesamt += tag.sollStd;
              } else {
                let tagesStd = tag.sollStd;
                if (eintrag && eintrag !== '0') {
                  tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
                }
                const manualPause = data.eintraege?.[key]?.pause;
                const { pauseAbzug } = berechnePausenabzug(tagesStd, ma.isMinor, manualPause);
                istGesamt += tagesStd - pauseAbzug;
              }
            }
          });
        });
      }

      // Zusatzzeiten (inkl. Teamsitzung)
      const zusatzKey = `${ma.name}-${monatKey}`;
      const maZusatz = data.zusatzzeiten?.[zusatzKey] || {};
      const vorbereitungTotal = (maZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
      const teamsitzungTotal = (maZusatz.teamsitzung || []).reduce((sum, e) => sum + e.stunden, 0);
      const buerozeitTotal = (maZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);
      const gesamt = istGesamt + vorbereitungTotal + teamsitzungTotal + buerozeitTotal;
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

      // C1/C2: Vertrag Std/Wo und Urlaubstag
      const vertragStdWo = gesamtStdMap[ma.name] || '-';
      const urlaubstagStd = typeof vertragStdWo === 'number' ? (vertragStdWo / 5) : '-';

      // M3: Vormonat-Saldo
      const vmSaldo = vormonatSaldoMap[ma.name];
      const vmSaldoDisplay = vmSaldo !== undefined ? vmSaldo.toFixed(1) : '-';

      uebersichtData.push([
        ma.name,
        bereichDisplay,
        vertragStdWo,
        urlaubstagStd !== '-' ? urlaubstagStd.toFixed(1) : '-',
        vmSaldoDisplay,
        sollGesamt,
        istGesamt,
        vorbereitungTotal || '-',
        teamsitzungTotal || '-',
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
      { wch: 14 }, // Vertrag Std/Wo
      { wch: 14 }, // Urlaubstag (Std)
      { wch: 14 }, // Übertrag Vorm.
      { wch: 10 }, // Soll-Std
      { wch: 11 }, // Arbeitszeit
      { wch: 12 }, // Vorbereitung
      { wch: 12 }, // Teamsitzung
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
      sheetData.push(['Woche', 'Tag', 'Datum', 'Von', 'Bis', 'Soll', 'Ist', 'Abweichung', 'Pause', 'Bemerkung']);

      let maGesamt = { soll: 0, ist: 0, pause: 0 };

      if (dienstplanWochen.length > 0) {
        dienstplanWochen.forEach((woche, wochenIdx) => {
          const maTage = woche.tage?.[ma.name] || [];

          maTage.forEach((tag, tagIdx) => {
            const key = `${ma.name}-${wochenIdx}-${tagIdx}`;
            const eintrag = data.eintraege?.[key]?.value;

            let istStd = 0;
            let abweichung = '-';
            let pauseAbzug = 0;
            let bemerkung = '';
            let vonStr = '';
            let bisStr = '';

            const istDienstplanAbwesend = ['K', 'U', 'KK', 'F', 'S', 'KS'].includes(tag.status);

            if (tag.sollStd === 0 && !istDienstplanAbwesend) {
              bemerkung = 'Kein Dienst';
              istStd = 0;
            } else if (istDienstplanAbwesend) {
              istStd = tag.sollStd;
              bemerkung = tag.status === 'KS' ? 'Krankschreibung' :
                         tag.status === 'K' ? 'Krank (o. KS)' :
                         tag.status === 'U' ? 'Urlaub' :
                         tag.status === 'KK' ? 'Kindkrankschreibung' :
                         tag.status === 'F' ? 'Fortbildung' :
                         tag.status === 'S' ? 'Seminar' : tag.status;
              // No Von/Bis for absence days
            } else if (['K', 'KS', 'U', 'KK', 'F'].includes(eintrag)) {
              istStd = tag.sollStd;
              bemerkung = eintrag === 'KS' ? 'Krankschreibung' :
                         eintrag === 'K' ? 'Krank (o. KS)' :
                         eintrag === 'U' ? 'Urlaub' :
                         eintrag === 'KK' ? 'Kindkrankschreibung' :
                         eintrag === 'F' ? 'Fortbildung' : eintrag;
            } else {
              let tagesStd = tag.sollStd;
              const numValue = (eintrag && eintrag !== '0') ? (parseFloat(eintrag) || 0) : 0;
              if (numValue !== 0) {
                tagesStd = tag.sollStd + numValue;
                abweichung = numValue > 0 ? `+${numValue}` : numValue.toString();
              } else {
                abweichung = '0';
              }
              const manualPause = data.eintraege?.[key]?.pause;
              const pauseResult = berechnePausenabzug(tagesStd, ma.isMinor, manualPause);
              pauseAbzug = pauseResult.pauseDisplay;
              istStd = tagesStd - pauseResult.pauseAbzug;

              // C3: Von/Bis berechnen
              vonStr = tag.von || '';
              if (tag.von && tag.bis) {
                const vonMin = parseTime(tag.von);
                const bisMin = parseTime(tag.bis);
                if (vonMin !== null && bisMin !== null) {
                  // Bis = Dienstplan-Bis + Abweichung (in Stunden → Minuten)
                  let adjustedBis = bisMin + Math.round(numValue * 60);
                  // Auto-Pause (>6h, keine manuelle Pause): +30min zur Bis-Zeit
                  if (manualPause === null || manualPause === undefined) {
                    const grenze = ma.isMinor ? 4.5 : 6;
                    if (tagesStd > grenze) {
                      adjustedBis += 30;
                    }
                  }
                  bisStr = formatTime(adjustedBis);
                } else {
                  bisStr = tag.bis || '';
                }
              }
            }

            maGesamt.soll += tag.sollStd;
            maGesamt.ist += istStd;
            maGesamt.pause += pauseAbzug;

            sheetData.push([
              woche.name,
              tag.tag,
              tag.datum,
              vonStr,
              bisStr,
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
      sheetData.push(['', '', 'SUMME', '', '', maGesamt.soll, maGesamt.ist, '', maGesamt.pause, '']);

      // Zusatzzeiten (inkl. Teamsitzung)
      const zusatzKey = `${ma.name}-${monatKey}`;
      const maZusatz = data.zusatzzeiten?.[zusatzKey] || {};
      const vorbereitungTotal = (maZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
      const teamsitzungTotal = (maZusatz.teamsitzung || []).reduce((sum, e) => sum + e.stunden, 0);
      const buerozeitTotal = (maZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);

      // Zusatzzeiten-Einträge mit von/bis Details
      const zusatzTypes = [
        { key: 'vorbereitung', label: 'Vorbereitung', total: vorbereitungTotal },
        { key: 'teamsitzung', label: 'Teamsitzung', total: teamsitzungTotal },
        { key: 'buerozeit', label: 'Bürozeit', total: buerozeitTotal }
      ];
      zusatzTypes.forEach(({ key, label, total }) => {
        if (total > 0) {
          const entries = maZusatz[key] || [];
          // Show individual day entries with von/bis
          entries.forEach(e => {
            if (e.stunden > 0) {
              sheetData.push([
                '', '', e.datum || '',
                e.von || '', e.bis || '',
                '', e.stunden, '',
                '', label
              ]);
            }
          });
          sheetData.push(['', '', `${label} Summe`, '', '', '', total, '', '', '']);
        }
      });

      // M3: Vormonat-Saldo in Einzel-Sheet
      const maVmSaldo = vormonatSaldoMap[ma.name];
      if (maVmSaldo !== undefined) {
        sheetData.push(['', '', `Übertrag Vormonat`, '', '', '', `${maVmSaldo >= 0 ? '+' : ''}${maVmSaldo.toFixed(1)}`, '', '', '']);
      }

      const gesamtMitZusatz = maGesamt.ist + vorbereitungTotal + teamsitzungTotal + buerozeitTotal;
      sheetData.push(['', '', 'GESAMT', '', '', maGesamt.soll, gesamtMitZusatz, '', '', '']);

      const maSheet = XLSX.utils.aoa_to_sheet(sheetData);
      maSheet['!cols'] = [
        { wch: 8 },  // Woche
        { wch: 5 },  // Tag
        { wch: 8 },  // Datum
        { wch: 7 },  // Von
        { wch: 7 },  // Bis
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
export async function GET(request) {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return jsonResponse({
        eintraege: {},
        approvals: {},
        submissions: {},
        zusatzzeiten: {},
        demo: true
      });
    }

    // Phase 5: Optionaler Monat-Parameter
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month');

    const data = await loadFromNextcloud(monthParam);
    return jsonResponse(data);

  } catch (error) {
    console.error('Fehler beim Laden:', error);
    return jsonResponse(
      { error: 'Einträge konnten nicht geladen werden', eintraege: {}, approvals: {} },
      500
    );
  }
}

// POST: Einträge speichern
export async function POST(request) {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return jsonResponse({
        success: true,
        message: 'Demo-Modus: Einträge werden nicht gespeichert',
        demo: true
      });
    }

    const body = await request.json();
    const { mitarbeiter, eintraege: neueEintraege, zusatzzeiten: neueZusatzzeiten } = body;

    if (!mitarbeiter) {
      return jsonResponse(
        { error: 'Mitarbeiter erforderlich' },
        400
      );
    }

    // Bestehende Daten laden
    const data = await loadFromNextcloud();

    // Neue Einträge für diesen Mitarbeiter zusammenführen
    if (neueEintraege) {
      Object.keys(neueEintraege).forEach(key => {
        if (key.startsWith(mitarbeiter + '-')) {
          // Unterstütze sowohl altes Format (nur value) als auch neues Format { value, sollStd }
          const eintrag = neueEintraege[key];
          const isNewFormat = typeof eintrag === 'object' && eintrag !== null && 'value' in eintrag;

          data.eintraege[key] = {
            value: isNewFormat ? eintrag.value : eintrag,
            sollStd: isNewFormat ? eintrag.sollStd : 0, // Phase 5: sollStd für Saldo-Berechnung
            pause: isNewFormat ? (eintrag.pause !== undefined ? eintrag.pause : null) : null, // M1: Pause pro Tag
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

    return jsonResponse({
      success: true,
      message: 'Einträge gespeichert',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fehler beim Speichern:', error);
    return jsonResponse(
      { error: 'Einträge konnten nicht gespeichert werden: ' + error.message },
      500
    );
  }
}

// PUT: Genehmigung durch Admin
export async function PUT(request) {
  try {
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return jsonResponse({
        success: true,
        message: 'Demo-Modus',
        demo: true
      });
    }

    const body = await request.json();
    const { mitarbeiter, monat, status, kommentar } = body;

    if (!mitarbeiter || !monat || !status) {
      return jsonResponse(
        { error: 'Mitarbeiter, Monat und Status erforderlich' },
        400
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

    return jsonResponse({
      success: true,
      message: `Status auf "${status}" gesetzt`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fehler bei Genehmigung:', error);
    return jsonResponse(
      { error: 'Genehmigung konnte nicht gespeichert werden: ' + error.message },
      500
    );
  }
}
