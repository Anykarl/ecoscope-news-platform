import React from 'react';

export default function StatisticsDashboard() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002';
  const [summary, setSummary] = React.useState(null);
  const [popular, setPopular] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`${apiUrl}/api/stats/summary`),
        fetch(`${apiUrl}/api/stats/popular`),
      ]);
      const s = await sRes.json();
      const p = await pRes.json();
      if (!sRes.ok || !s.success) throw new Error(s.message || 'Summary error');
      if (!pRes.ok || !p.success) throw new Error(p.message || 'Popular error');
      setSummary({ totalReads: s.totalReads, articleCount: s.articleCount });
      setPopular(p.items || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally { setLoading(false); }
  }, [apiUrl]);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Statistiques</h2>
        <button onClick={load} disabled={loading} className="px-3 py-2 rounded-md text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">{loading ? 'Chargement…' : 'Rafraîchir'}</button>
      </div>
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div className="text-xs text-gray-500">Lectures totales</div>
            <div className="text-2xl font-bold">{summary.totalReads}</div>
          </div>
          <div className="p-3 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
            <div className="text-xs text-gray-500">Nombre d'articles (vus)</div>
            <div className="text-2xl font-bold">{summary.articleCount}</div>
          </div>
        </div>
      )}
      <div className="mt-4">
        <h3 className="font-semibold mb-2">Articles populaires</h3>
        {popular.length === 0 ? (
          <div className="text-sm text-gray-500">Aucune donnée encore.</div>
        ) : (
          <ul className="space-y-2">
            {popular.map(item => (
              <li key={item.id} className="flex items-center justify-between p-2 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
                <span className="text-sm">#{item.id}</span>
                <span className="text-sm text-gray-600">{item.reads} lectures</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
