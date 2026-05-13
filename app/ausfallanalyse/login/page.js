'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/ausfallanalyse/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push('/ausfallanalyse');
      router.refresh();
    } else {
      setError('Falsches Passwort');
      setPassword('');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 w-full max-w-xs">
        <div className="text-center mb-8">
          <div className="text-xl font-bold text-gray-800">Wukaninchen</div>
          <div className="text-sm text-gray-400 mt-1">Betriebszustand-Analyse</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Passwort"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
          />

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-gray-800 text-white py-3 rounded-xl font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Prüfe…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}
