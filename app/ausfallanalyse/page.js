'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const FARBEN = {
  A: '#27ae60', B: '#a8d8a8', C: '#f39c12', D: '#5dade2',
  E: '#fd79a8', F: '#e74c3c', G: '#7b241c', P: '#b2bec3',
  W: '#dfe6e9', '?': '#95a5a6',
};
const NAMEN = {
  A: 'Vollbetrieb', B: 'Intern kompensiert', C: 'Externe Vertretung',
  D: 'Minimalbetrieb', E: 'Kinderzahlbegrenzung', F: 'Notbetreuung',
  G: 'Vollschließung', P: 'Geplant geschlossen',
  W: 'Feiertag', '?': 'Daten fehlen',
};
const MONAT_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
// FK-Schwellenwerte nach §10 Abs. 1 KitaG Brandenburg (GVBl.I/25, Nr. 12)
// Kinderzahlen verifiziert aus ÜbersichtKinderdaten.ods (Nextcloud, Sheet 2025-26)
// Wald Ü3: 20 Kinder ÷ 10 Kinder/Stelle = 2,0 Stellen → Minimum 2 FK
// Haus U3: 12 Kinder ÷ 4,25 Kinder/Stelle = 2,82 Stellen → Minimum 3 FK
const FK_GESETZ_MIN = { wald: 2, haus: 3 };
const FK_KOMFORT_MIN = { wald: 3, haus: 4 };
const WDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function fmt(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function TagModal({ day, kita, fkMin, fkKomfortMin, onClose }) {
  if (!day) return null;
  const { date, info } = day;
  const z = info?.zustand || '?';
  const nFk = info?.n_fk;
  const verifiziert = info?.verifiziert;
  const [y, mo, d] = date.split('-').map(Number);
  const wday = new Date(y, mo - 1, d).getDay();

  let fkStatus = null;
  if (nFk != null && !['W', 'P', '?'].includes(z)) {
    if (nFk >= fkKomfortMin)
      fkStatus = `${nFk} FK im Einsatz — Komfortgrenze (≥${fkKomfortMin}) erfüllt`;
    else if (nFk >= fkMin)
      fkStatus = `${nFk} FK im Einsatz — gesetzl. Minimum (${fkMin}) erfüllt`;
    else if (nFk > 0)
      fkStatus = `${nFk} FK im Einsatz — unterbesetzt (Minimum: ${fkMin})`;
    else
      fkStatus = 'Keine FK im Dienstplan eingetragen';
  }

  const quelle = verifiziert
    ? `Manuelle Annotation — Signal (${kita === 'wald' ? 'Wald-Gruppe' : 'Hauskita-Gruppe'})`
    : `Dienstplan ${y}_${String(mo).padStart(2, '0')} (auto-klassifiziert)`;

  const textOnColor = ['F', 'G'].includes(z) ? '#fff' : 'rgba(0,0,0,0.7)';

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-gray-800">
            {WDAY_DE[wday]}, {d}. {MONAT_LANG[mo - 1]} {y}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-1">×</button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: FARBEN[z] || '#dfe6e9', color: textOnColor }}
          >
            {z}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{NAMEN[z] || z}</div>
            {['F', 'G', 'E'].includes(z) && (
              <div className="text-[11px] text-red-400 mt-0.5">Nur aus Signal-Nachricht</div>
            )}
          </div>
        </div>

        {fkStatus && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 mb-3">{fkStatus}</div>
        )}

        <div className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">
          <span className="font-medium text-gray-500">Quelle:</span>{' '}{quelle}
        </div>

        {info?.spaetbetreuung_ausgefallen && (
          <div className="text-xs text-orange-600 bg-orange-50 rounded-lg p-2 mt-3">
            Spätbetreuung ausgefallen (Waldkita 16:00–18:00 Uhr)
          </div>
        )}
      </div>
    </div>
  );
}

function MonatKalender({ year, month, tage, fkMin, onDayClick }) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const moOffset = (firstWeekday === 0 || firstWeekday === 6) ? 0 : firstWeekday - 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < moOffset; i++) cells.push(<div key={`e${i}`} />);

  for (let d = 1; d <= daysInMonth; d++) {
    const wday = new Date(year, month - 1, d).getDay();
    if (wday === 0 || wday === 6) continue;

    const key = fmt(year, month, d);
    const info = tage?.[key];
    const z = info?.zustand || '?';
    const bg = FARBEN[z] || '#ccc';
    const textCol = ['F', 'G'].includes(z) ? '#fff' : 'rgba(0,0,0,0.65)';
    const spaet = info?.spaetbetreuung_ausgefallen;
    const nFk = info?.n_fk;
    const showFkCount = nFk != null && !['W', 'P', '?'].includes(z);

    cells.push(
      <div
        key={d}
        onClick={() => onDayClick?.({ date: key, info })}
        className="relative rounded flex flex-col items-center justify-center cursor-pointer select-none hover:opacity-75 active:scale-95 transition-all"
        style={{ background: bg, minHeight: 40 }}
      >
        <span className="text-[10px] font-semibold leading-none" style={{ color: textCol }}>{d}</span>
        <span className="text-[8px] font-bold leading-none mt-0.5" style={{ color: textCol }}>{z}</span>
        {showFkCount && (
          <span className="text-[7px] leading-none mt-0.5 opacity-80" style={{ color: textCol }}>{nFk}/{fkMin}</span>
        )}
        {spaet && (
          <span
            className="absolute bottom-0.5 right-0.5"
            style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderBottom: '10px solid #e74c3c' }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
        {MONAT_LANG[month - 1]} {year}
      </div>
      <div className="grid grid-cols-5 gap-px mb-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map(wd => (
          <div key={wd} className="text-[9px] text-center text-gray-300 font-medium">{wd}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-px">{cells}</div>
    </div>
  );
}

function SummaryKarten({ tage }) {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  for (const [, info] of Object.entries(tage || {})) {
    const z = info?.zustand;
    if (z && counts[z] !== undefined) counts[z]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const karten = [
    { z: 'A', label: 'Vollbetrieb' },
    { z: 'B', label: 'Intern komp.' },
    { z: 'C', label: 'Externe Vertr.' },
    { z: 'D', label: 'Minimalbetrieb' },
    { z: 'E', label: 'Kinderzahl-Begr.' },
    { z: 'F', label: 'Notbetreuung' },
    { z: 'G', label: 'Vollschließung' },
  ];
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-0.5">
        Arbeitstage 2026 (Jan–Mai)
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {karten.map(({ z, label }) => (
          <div key={z} className="bg-white rounded-xl p-3 shadow-sm border-l-4" style={{ borderLeftColor: FARBEN[z] }}>
            <div className="text-2xl font-bold text-gray-800">{counts[z]}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
            {total > 0 && counts[z] > 0 && (
              <div className="text-[10px] text-gray-300 mt-0.5">{Math.round(100 * counts[z] / total)}%</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VerlaufChart({ tage }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!tage || !canvasRef.current) return;

    const monthSet = new Set();
    for (const d of Object.keys(tage)) {
      if (d.startsWith('2026')) monthSet.add(d.slice(0, 7));
    }
    const months = [...monthSet].sort();
    const labels = months.map(m => MONAT_KURZ[parseInt(m.split('-')[1]) - 1]);

    const zustande = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const totals = months.map(m => {
      let tot = 0;
      for (const [d, info] of Object.entries(tage)) {
        if (d.startsWith(m) && zustande.includes(info?.zustand)) tot++;
      }
      return tot;
    });

    const datasets = zustande.map(z => {
      const data = months.map((m, i) => {
        let count = 0;
        for (const [d, info] of Object.entries(tage)) {
          if (d.startsWith(m) && info?.zustand === z) count++;
        }
        return totals[i] > 0 ? Math.round(1000 * count / totals[i]) / 10 : 0;
      });
      if (!data.some(v => v > 0)) return null;
      return { label: `${z} – ${NAMEN[z]}`, data, backgroundColor: FARBEN[z], stack: 'stack' };
    }).filter(Boolean);

    import('chart.js').then(({ Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend }) => {
      Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => labels[ctx[0].dataIndex],
                label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%`,
              },
            },
          },
          scales: {
            x: { stacked: true, ticks: { font: { size: 10 } } },
            y: {
              stacked: true,
              max: 100,
              title: { display: true, text: 'Anteil Arbeitstage (%)', font: { size: 11 } },
              ticks: { callback: v => `${v}%`, font: { size: 10 } },
            },
          },
        },
      });
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [tage]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-600 mb-3">Verlauf 2026 — Anteil je Zustand</div>
      <div style={{ height: 260 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export default function AusfallanalysePage() {
  const [tage, setTage] = useState(null);
  const [error, setError] = useState(null);
  const [kita, setKita] = useState('wald');
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    fetch('/api/ausfallanalyse/data')
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setTage(d.tage))
      .catch(e => setError(e.message));
  }, []);

  // Flatten to per-kita view, 2026 only
  const tageFlat = tage
    ? Object.fromEntries(
        Object.entries(tage)
          .filter(([d]) => d.startsWith('2026'))
          .map(([d, v]) => [d, v[kita] ?? v])
      )
    : null;

  const monate2026 = tage
    ? Array.from({ length: 5 }, (_, i) => i + 1).filter(m => {
        const prefix = `2026-${String(m).padStart(2, '0')}`;
        return Object.keys(tage).some(d => d.startsWith(prefix));
      })
    : [];

  async function handleLogout() {
    await fetch('/api/ausfallanalyse/auth', { method: 'DELETE' });
    window.location.href = '/ausfallanalyse/login';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {selectedDay && (
        <TagModal
          day={selectedDay}
          kita={kita}
          fkMin={FK_GESETZ_MIN[kita]}
          fkKomfortMin={FK_KOMFORT_MIN[kita]}
          onClose={() => setSelectedDay(null)}
        />
      )}

      <div className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow">
        <div>
          <div className="font-semibold text-sm">Betriebszustand 2026</div>
          <div className="text-xs text-gray-400">Kita Wukaninchen</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-white/20">
            <button
              onClick={() => setKita('wald')}
              className={`text-xs px-3 py-1.5 transition-colors ${
                kita === 'wald' ? 'bg-white text-gray-800 font-semibold' : 'text-gray-300 hover:text-white'
              }`}
            >
              Wald
            </button>
            <button
              onClick={() => setKita('haus')}
              className={`text-xs px-3 py-1.5 transition-colors ${
                kita === 'haus' ? 'bg-white text-gray-800 font-semibold' : 'text-gray-300 hover:text-white'
              }`}
            >
              Haus
            </button>
          </div>
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-white transition-colors">
            Abmelden
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {!tage && !error && (
          <div className="text-gray-400 text-sm text-center py-12">Lade Daten…</div>
        )}
        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            <strong>Fehler:</strong> {error}
            <p className="mt-1 text-red-500 text-xs">
              Stelle sicher, dass betriebszustand_tage.json auf Nextcloud vorhanden ist (GitHub Action ausführen).
            </p>
          </div>
        )}

        {tageFlat && (
          <>
            <SummaryKarten tage={tageFlat} />

            <VerlaufChart tage={tageFlat} />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {monate2026.map(m => (
                <MonatKalender
                  key={`${kita}-${m}`}
                  year={2026}
                  month={m}
                  tage={tageFlat}
                  fkMin={FK_GESETZ_MIN[kita]}
                  onDayClick={setSelectedDay}
                />
              ))}
            </div>

            {/* Legende */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Legende — Betriebszustände
              </div>

              {/* Schwellenwerte-Box */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                <div className="font-semibold text-gray-700 mb-1">
                  Schwellenwerte — {kita === 'wald' ? 'Waldkita (Ü3, 20 Kinder)' : 'Hauskita / Nest (U3, 12 Kinder)'}
                </div>
                <div>
                  <span className="font-medium">Komfortgrenze:</span>{' '}
                  ≥{FK_KOMFORT_MIN[kita]} FK im Einsatz → A (kein Krank) oder B (mit Krank)
                </div>
                <div>
                  <span className="font-medium">Gesetzl. Minimum:</span>{' '}
                  ≥{FK_GESETZ_MIN[kita]} FK → D (Minimalbetrieb, gilt als Normalbetrieb)
                </div>
                <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-200 mt-1">
                  §10 Abs. 1 KitaG Brandenburg (GVBl.I/25, Nr. 12) ·{' '}
                  {kita === 'wald'
                    ? '20 Kinder ÷ 10 Kinder/Stelle = 2,0 Stellen → Min. 2 FK'
                    : '12 Kinder ÷ 4,25 Kinder/Stelle = 2,82 Stellen → Min. 3 FK'}
                  {' '}· Kinderzahl verifiziert aus Betreuungsübersicht 2025-26 (Nextcloud)
                </div>
                <div className="text-[10px] text-gray-400">
                  Kalenderfeld: FK im Einsatz / Minimum (z.B. «2/2» = 2 FK, Minimum 2) · Klick auf Tag für Details
                </div>
              </div>

              <div className="space-y-2.5">
                {[
                  {
                    z: 'A',
                    desc: `≥${FK_KOMFORT_MIN[kita]} FK im Einsatz, kein Kranktag. Komfortgrenze erfüllt.`,
                    quelle: 'Auto',
                  },
                  {
                    z: 'B',
                    desc: `≥${FK_KOMFORT_MIN[kita]} FK im Einsatz trotz Kranktag. Komfortgrenze durch anwesende Kolleg:innen gedeckt.`,
                    quelle: 'Auto',
                  },
                  {
                    z: 'C',
                    desc: 'Externe Vertretungskraft aus dem Vertretungspool im Einsatz.',
                    quelle: 'Auto',
                  },
                  {
                    z: 'D',
                    desc: `Dienstplan zeigt ${FK_GESETZ_MIN[kita]}–${FK_KOMFORT_MIN[kita] - 1} FK. Kein Signal über Notbetreuung — gilt als Normalbetrieb. FK-Zahl im Kalenderfeld.`,
                    quelle: 'Auto',
                  },
                  {
                    z: 'E',
                    desc: 'Eltern aktiv gebeten, Kinder wenn möglich zu Hause zu lassen.',
                    quelle: 'Nur Signal',
                  },
                  {
                    z: 'F',
                    desc: 'Formale Notbetreuung — nur wenn in Signal-Nachricht explizit so kommuniziert.',
                    quelle: 'Nur Signal',
                  },
                  {
                    z: 'G',
                    desc: 'Kita vollständig geschlossen — nur wenn in Signal-Nachricht so kommuniziert.',
                    quelle: 'Nur Signal',
                  },
                  {
                    z: 'P',
                    desc: 'Geplante Schließung: Betriebsferien, Klausurtage, Brückentage. Nicht in der Statistik.',
                    quelle: 'Statisch',
                  },
                  {
                    z: 'W',
                    desc: 'Gesetzlicher Feiertag auf einem Werktag (Kalender zeigt nur Mo–Fr).',
                    quelle: 'Statisch',
                  },
                  {
                    z: '?',
                    desc: 'Kein Dienstplan-Eintrag für diesen Tag. ODS-Datei fehlt oder noch nicht hochgeladen.',
                    quelle: '',
                  },
                ].map(({ z, desc, quelle }) => (
                  <div key={z} className="flex items-start gap-2">
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{
                        background: FARBEN[z] || '#dfe6e9',
                        color: ['F', 'G'].includes(z) ? '#fff' : 'rgba(0,0,0,0.65)',
                      }}
                    >
                      {z}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-700">{NAMEN[z] || z}</span>
                        {quelle && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              quelle === 'Nur Signal'
                                ? 'bg-red-50 text-red-500'
                                : quelle === 'Auto'
                                ? 'bg-blue-50 text-blue-400'
                                : 'bg-gray-100 text-gray-400'
                            }`}
                          >
                            {quelle}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{desc}</div>
                    </div>
                  </div>
                ))}

                {kita === 'wald' && (
                  <div className="flex items-start gap-2 pt-2 border-t border-gray-100">
                    <div className="w-6 h-6 rounded bg-gray-100 flex items-end justify-end p-0.5 shrink-0 mt-0.5">
                      <span style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderBottom: '10px solid #e74c3c' }} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-700">Spätbetreuung ausgefallen</span>
                      <div className="text-xs text-gray-500">
                        Geplante Spätbetreuung Waldkita (16:00–18:00 Uhr) ausgefallen. Nur Waldkita relevant.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
