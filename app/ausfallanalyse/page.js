'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const FARBEN = {
  A: '#27ae60', B: '#a8d8a8', C: '#f39c12', D: '#e67e22',
  E: '#e74c3c', F: '#7b241c', G: '#b2bec3', '?': '#95a5a6',
};
const NAMEN = {
  A: 'Normalbetrieb', B: 'Intern kompensiert', C: 'Externe Kosten / Grauzone',
  D: 'Eltern gebeten', E: 'Notbetreuung', F: 'Vollschließung',
  G: 'Geplante Schließung', '?': 'Daten fehlen',
};
const MONAT_LANG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function fmt(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function MonatKalender({ year, month, tage }) {
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=So
  // For a Mon–Fri-only grid: Sat/Sun → 0 offset (first work day is next Monday)
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
    const textCol = z === 'F' ? '#fff' : 'rgba(0,0,0,0.65)';
    const spaet = info?.spaetbetreuung_ausgefallen;
    const tip = `${d}.${month}.${year} – ${NAMEN[z] || z}${spaet ? ' · Spätbetreuung ⚠' : ''}${info?.begruendung ? '\n' + info.begruendung : ''}`;

    cells.push(
      <div
        key={d}
        title={tip}
        className="relative rounded flex flex-col items-center justify-center cursor-default select-none"
        style={{ background: bg, minHeight: 36 }}
      >
        <span className="text-[10px] font-semibold leading-none" style={{ color: textCol }}>{d}</span>
        <span className="text-[8px] font-bold leading-none mt-0.5" style={{ color: textCol }}>{z}</span>
        {spaet && (
          <span
            className="absolute bottom-0.5 right-0.5"
            style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderBottom: '5px solid #e67e22',
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
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  for (const [date, info] of Object.entries(tage || {})) {
    if (!date.startsWith(String(year))) continue;
    const z = info.zustand;
    if (counts[z] !== undefined) counts[z]++;
  }
  const karten = [
    { z: 'A', label: 'Normalbetrieb' },
    { z: 'B', label: 'Intern kompensiert' },
    { z: 'C', label: 'Externe Vertretung' },
    { z: 'D', label: 'Eltern gebeten' },
    { z: 'E', label: 'Notbetreuung' },
    { z: 'F', label: 'Vollschließung' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {karten.map(({ z, label }) => (
        <div key={z} className="bg-white rounded-xl p-3 shadow-sm border-l-4" style={{ borderLeftColor: FARBEN[z] }}>
          <div className="text-2xl font-bold text-gray-800">{counts[z]}</div>
          <div className="text-xs text-gray-400 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

function VerlaufChart({ tage }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!tage || !canvasRef.current) return;

    // Collect sorted month keys
    const monthSet = new Set();
    for (const d of Object.keys(tage)) monthSet.add(d.slice(0, 7));
    const months = [...monthSet].sort();

    const labels = months.map(m => {
      const [y, mo] = m.split('-');
      return `${MONAT_KURZ[parseInt(mo) - 1]} ${y.slice(2)}`;
    });

    const zustande = ['A', 'B', 'C', 'D', 'E', 'F'];
    const datasets = zustande.map(z => {
      const data = months.map(m => {
        let count = 0;
        for (const [d, info] of Object.entries(tage)) {
          if (d.startsWith(m) && info.zustand === z) count++;
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
            legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } },
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

  useEffect(() => {
    fetch('/api/ausfallanalyse/data')
      .then(r => r.json())
      .then(d => d.error ? setError(d.error) : setTage(d.tage))
      .catch(e => setError(e.message));
  }, []);

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
        <div className="flex items-center gap-3">
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

        {tage && (
          <>
            <SummaryKarten tage={tage} year={year} />

            <VerlaufChart tage={tage} />

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
                <MonatKalender key={m} year={year} month={m} tage={tage} />
              ))}
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Legende</div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(z => (
                  <div key={z} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0"
                      style={{ background: FARBEN[z], color: z === 'F' ? '#fff' : 'rgba(0,0,0,0.6)' }}
                    >
                      {z}
                    </div>
                    {NAMEN[z]}
                  </div>
                ))}
                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                  <div className="w-5 h-5 rounded bg-gray-100 flex items-end justify-end p-0.5 shrink-0">
                    <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderBottom: '5px solid #e67e22' }} />
                  </div>
                  Spätbetreuung ausgefallen
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
