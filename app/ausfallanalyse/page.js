'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const FARBEN = {
  A: '#27ae60', B: '#a8d8a8', C: '#f39c12', D: '#e67e22',
  E: '#fd79a8', F: '#e74c3c', G: '#7b241c', P: '#b2bec3', '?': '#95a5a6',
};
const NAMEN = {
  A: 'Normalbetrieb', B: 'Intern kompensiert', C: 'Externe Vertretung',
  D: 'Gesetzl. Minimum', E: 'Eltern gebeten', F: 'Notbetreuung',
  G: 'Vollschließung', P: 'Geplant geschlossen', '?': 'Daten fehlen',
};
const MONAT_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const SIGNAL_START = '2025-04-01';
// FK-Schwellenwerte nach §10 Abs. 1 KitaG Brandenburg (GVBl.I/25, Nr. 12)
// Wald Ü3: 15 Kinder ÷ 10 Kinder/Stelle = 1,5 Stellen → Minimum 2 FK
// Haus U3: 10 Kinder ÷ 4,25 Kinder/Stelle = 2,35 Stellen → Minimum 3 FK
const FK_GESETZ_MIN = { wald: 2, haus: 3 };
const FK_KOMFORT_MIN = { wald: 3, haus: 4 };

function fmt(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function MonatKalender({ year, month, tage, fkMin }) {
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
    const textCol = z === 'G' ? '#fff' : z === 'F' ? '#fff' : 'rgba(0,0,0,0.65)';
    const spaet = info?.spaetbetreuung_ausgefallen;
    const verifiziert = info?.verifiziert ?? true;
    const nFk = info?.n_fk;
    const showFkCount = nFk != null && z !== 'W' && z !== 'P' && z !== '?';

    const fkLine = showFkCount ? ` · ${nFk}/${fkMin} FK im Einsatz/Minimum` : '';
    const tip = `${d}.${month}.${year} – ${NAMEN[z] || z}${fkLine}${spaet ? ' · Spätbetreuung ⚠' : ''}${key < SIGNAL_START && !verifiziert && z !== '?' && z !== 'P' && z !== 'W' ? ' (auto-klassifiziert)' : ''}${info?.begruendung ? '\n' + info.begruendung : ''}`;

    const showHatch = !verifiziert && key < SIGNAL_START && z !== '?' && z !== 'P' && z !== 'W';
    const cellStyle = showHatch
      ? {
          backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 2px, transparent 2px, transparent 6px)',
          backgroundColor: bg,
          minHeight: 40,
        }
      : { background: bg, minHeight: 40 };

    cells.push(
      <div
        key={d}
        title={tip}
        className="relative rounded flex flex-col items-center justify-center cursor-default select-none"
        style={cellStyle}
      >
        <span className="text-[10px] font-semibold leading-none" style={{ color: textCol }}>{d}</span>
        <span className="text-[8px] font-bold leading-none mt-0.5" style={{ color: textCol }}>{z}</span>
        {showFkCount && (
          <span className="text-[7px] leading-none mt-0.5 opacity-80" style={{ color: textCol }}>{nFk}/{fkMin}</span>
        )}
        {spaet && (
          <span
            className="absolute bottom-0.5 right-0.5"
            style={{
              width: 0, height: 0,
              borderLeft: '10px solid transparent',
              borderBottom: '10px solid #e74c3c',
            }}
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
        {['Mo', 'Di', 'Mi', 'Do', 'Fr'].map(d => (
          <div key={d} className="text-[9px] text-center text-gray-300 font-medium">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-px">{cells}</div>
    </div>
  );
}

function SummaryKarten({ tage, year }) {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
  for (const [date, info] of Object.entries(tage || {})) {
    if (!date.startsWith(String(year))) continue;
    const z = info?.zustand;
    if (z && counts[z] !== undefined) counts[z]++;
  }
  const karten = [
    { z: 'A', label: 'Normalbetrieb' },
    { z: 'B', label: 'Intern kompensiert' },
    { z: 'C', label: 'Externe Vertretung' },
    { z: 'D', label: 'Gesetzl. Minimum' },
    { z: 'E', label: 'Eltern gebeten' },
    { z: 'F', label: 'Notbetreuung' },
    { z: 'G', label: 'Vollschließung' },
  ];
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-0.5">
        Arbeitstage {year}
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {karten.map(({ z, label }) => (
          <div key={z} className="bg-white rounded-xl p-3 shadow-sm border-l-4" style={{ borderLeftColor: FARBEN[z] }}>
            <div className="text-2xl font-bold text-gray-800">{counts[z]}</div>
            <div className="text-xs text-gray-400 mt-0.5">{label}</div>
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
    for (const d of Object.keys(tage)) monthSet.add(d.slice(0, 7));
    const months = [...monthSet].sort();

    const labels = months.map(m => {
      const [y, mo] = m.split('-');
      return `${MONAT_KURZ[parseInt(mo) - 1]} ${y.slice(2)}`;
    });

    const zustande = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const datasets = zustande.map(z => {
      const data = months.map(m => {
        let count = 0;
        for (const [d, info] of Object.entries(tage)) {
          if (d.startsWith(m) && info?.zustand === z) count++;
        }
        return count;
      });
      return {
        label: `${z} – ${NAMEN[z]}`,
        data,
        backgroundColor: FARBEN[z],
        stack: 'stack',
      };
    });

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
                title: ctx => `${labels[ctx[0].dataIndex]}`,
                label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
              },
            },
          },
          scales: {
            x: { stacked: true, ticks: { font: { size: 10 } } },
            y: { stacked: true, title: { display: true, text: 'Arbeitstage', font: { size: 11 } } },
          },
        },
      });
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [tage]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-600 mb-3">Verlauf nach Monat</div>
      <div style={{ height: 280 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export default function AusfallanalysePage() {
  const [tage, setTage] = useState(null);
  const [error, setError] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [kita, setKita] = useState('wald');

  useEffect(() => {
    fetch('/api/ausfallanalyse/data')
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setTage(d.tage))
      .catch(e => setError(e.message));
  }, []);

  // Flatten per-kita view for all child components
  const tageFlat = tage
    ? Object.fromEntries(
        Object.entries(tage).map(([d, v]) => [d, v[kita] ?? v])
      )
    : null;

  const jahre = tage
    ? [...new Set(Object.keys(tage).map(d => d.slice(0, 4)).filter(Boolean))].sort()
    : [];

  const monate = tage
    ? Array.from({ length: 12 }, (_, i) => i + 1).filter(m => {
        const prefix = `${year}-${String(m).padStart(2, '0')}`;
        return Object.keys(tage).some(d => d.startsWith(prefix));
      })
    : [];

  async function handleLogout() {
    await fetch('/api/ausfallanalyse/auth', { method: 'DELETE' });
    window.location.href = '/ausfallanalyse/login';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow">
        <div>
          <div className="font-semibold text-sm">Betriebszustand</div>
          <div className="text-xs text-gray-400">Kita Wukaninchen</div>
        </div>
        <div className="flex items-center gap-2">
          {/* Kita-Toggle */}
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
          <Link
            href="/ausfallanalyse/annotate"
            className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Annotation
          </Link>
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
            <SummaryKarten tage={tageFlat} year={year} />

            <VerlaufChart tage={tageFlat} />

            {jahre.length > 1 && (
              <div className="flex gap-2">
                {jahre.map(y => (
                  <button
                    key={y}
                    onClick={() => setYear(parseInt(y))}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      year === parseInt(y)
                        ? 'bg-gray-800 text-white'
                        : 'bg-white text-gray-600 shadow-sm hover:bg-gray-100'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {monate.map(m => (
                <MonatKalender key={`${kita}-${m}`} year={year} month={m} tage={tageFlat} fkMin={FK_GESETZ_MIN[kita]} />
              ))}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Legende — Betriebszustände</div>

              {/* Schwellenwerte-Box — kita-spezifisch */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                <div className="font-semibold text-gray-700 mb-1">
                  Schwellenwerte — {kita === 'wald' ? 'Waldkita (Ü3, ~15 Kinder)' : 'Hauskita / Nest (U3, ~10 Kinder)'}
                </div>
                <div>
                  <span className="font-medium">Komfortgrenze:</span>
                  {' '}≥{FK_KOMFORT_MIN[kita]} FK im Einsatz → Zustand A (kein Krank) oder B (mit Krank)
                </div>
                <div>
                  <span className="font-medium">Gesetzl. Minimum:</span>
                  {' '}{FK_GESETZ_MIN[kita]} FK → Zustand D · Unter Minimum → F · Null FK → G
                </div>
                <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-200 mt-1">
                  Quelle: §10 Abs. 1 KitaG Brandenburg (GVBl.I/25, Nr. 12) ·{' '}
                  {kita === 'wald'
                    ? '15 Kinder ÷ 10 Kinder/Stelle = 1,5 Stellen → Min. 2 FK'
                    : '10 Kinder ÷ 4,25 Kinder/Stelle = 2,35 Stellen → Min. 3 FK'}
                </div>
                <div className="text-[10px] text-gray-400">
                  Zahl im Kalenderfeld = FK im Einsatz / gesetzl. Minimum (z.B. «3/2» = 3 FK anwesend, Minimum 2)
                </div>
              </div>

              <div className="space-y-2">
                {[
                  { z: 'A', desc: `≥${FK_KOMFORT_MIN[kita]} FK im Einsatz, kein Kranktag. Komfortgrenze erfüllt, Betrieb ohne Einschränkungen.` },
                  { z: 'B', desc: `≥${FK_KOMFORT_MIN[kita]} FK im Einsatz trotz Kranktag. Komfortgrenze durch anwesende Kolleg:innen gedeckt, kein externer Einsatz nötig.` },
                  { z: 'C', desc: 'Externe Vertretungskraft aus dem Vertretungspool im Einsatz. Betreuung möglich, aber mit externer Unterstützung.' },
                  { z: 'D', desc: `Genau ${FK_GESETZ_MIN[kita]} FK im Einsatz — gesetzl. Minimum nach §10 Abs. 1 KitaG Bbg. Kein Puffer, jeder weitere Ausfall wäre kritisch.` },
                  { z: 'E', desc: 'Eltern aktiv gebeten, Kinder wenn möglich zu Hause zu lassen. Manuell erfasst.' },
                  { z: 'F', desc: `Unter gesetzl. Minimum (${FK_GESETZ_MIN[kita] - 1} oder weniger FK im Einsatz). Formale Notbetreuung mit stark reduzierter Kapazität.` },
                  { z: 'G', desc: 'Kita vollständig geschlossen, auch für Notfälle. Manuell erfasst.' },
                  { z: 'P', desc: 'Geplante Schließung: Betriebsferien, Klausurtage, Brückentage. Nicht in der Statistik.' },
                  { z: 'W', desc: 'Gesetzlicher Feiertag. Da der Kalender nur Mo–Fr zeigt, entspricht W immer einem Feiertag auf einem Werktag.' },
                  { z: '?', desc: 'Kein Dienstplan-Eintrag für diesen Tag. ODS-Datei fehlt oder noch nicht hochgeladen.' },
                ].map(({ z, desc }) => (
                  <div key={z} className="flex items-start gap-2">
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: FARBEN[z] || '#dfe6e9', color: z === 'G' ? '#fff' : z === 'F' ? '#fff' : 'rgba(0,0,0,0.65)' }}
                    >
                      {z}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-700">{NAMEN[z] || z}</span>
                      <span className="text-xs text-gray-500"> — {desc}</span>
                    </div>
                  </div>
                ))}
                {/* Schraffierung */}
                <div className="flex items-start gap-2 pt-1 border-t border-gray-100">
                  <div
                    className="w-6 h-6 rounded shrink-0 mt-0.5"
                    style={{
                      backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0px, rgba(255,255,255,0.45) 2px, transparent 2px, transparent 6px)',
                      backgroundColor: FARBEN['B'],
                    }}
                  />
                  <div>
                    <span className="text-xs font-semibold text-gray-700">Schraffierung</span>
                    <span className="text-xs text-gray-500"> — Nur auto-klassifiziert aus Dienstplan (Jan–Mär 2025).</span>
                  </div>
                </div>
                {/* Spätbetreuung — nur Wald */}
                {kita === 'wald' && (
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded bg-gray-100 flex items-end justify-end p-0.5 shrink-0 mt-0.5">
                      <span style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderBottom: '10px solid #e74c3c' }} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-700">Spätbetreuung ausgefallen</span>
                      <span className="text-xs text-gray-500"> — Geplante Spätbetreuung Waldkita (16:00–18:00 Uhr) ausgefallen. Nur Waldkita relevant.</span>
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
