import React from 'react';
import ArticleAdminForm from '../components/ArticleAdminForm.jsx';

export default function AdminPage() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
  const [backups, setBackups] = React.useState([]);
  const [selected, setSelected] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');

  const loadBackups = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiUrl}/api/backups`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Erreur');
      setBackups(data.backups || []);
    } catch (e) {
      setMessage(`Erreur chargement sauvegardes: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  React.useEffect(() => { loadBackups(); }, [loadBackups]);

  const selectBackup = async () => {
    if (!selected) { setMessage('Veuillez sélectionner une sauvegarde.'); return; }
    try {
      setLoading(true);
      const res = await fetch(`${apiUrl}/api/backups/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: selected })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Erreur de sélection');
      setMessage(`Sauvegarde sélectionnée: ${data.selected}. Pour restaurer: npm run restore -- --name selected`);
    } catch (e) {
      setMessage(`Erreur: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 text-gray-900 dark:text-gray-100">
      <h1 className="text-2xl font-bold mb-4">EcoScope Admin</h1>
      <ArticleAdminForm />

      <div className="mt-8 border-t pt-6">
        <h2 className="text-xl font-semibold mb-3">Sauvegardes du projet</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">Créez des sauvegardes via la commande côté backend, puis sélectionnez-en une ici pour préparer une restauration manuelle.</p>
        <div className="flex items-center gap-2 mb-3">
          <button onClick={loadBackups} disabled={loading} className="px-3 py-2 rounded-md text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">
            {loading ? 'Chargement…' : 'Rafraîchir la liste'}
          </button>
          <select value={selected} onChange={e=>setSelected(e.target.value)} className="border rounded px-2 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600">
            <option value="">-- Sélectionner une sauvegarde --</option>
            {backups.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
          <button onClick={selectBackup} disabled={loading || !selected} className={`px-3 py-2 rounded-md text-sm ${selected? 'bg-emerald-600 text-white hover:bg-emerald-700':'bg-gray-200 text-gray-500 cursor-not-allowed'}`}>Enregistrer la sélection</button>
        </div>
        {message && <div className="text-sm text-emerald-700 dark:text-emerald-400">{message}</div>}
        <div className="mt-4 text-xs text-gray-600 dark:text-gray-400">
          <div>Créer une sauvegarde: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">npm run backup</code></div>
          <div>Restaurer la sauvegarde sélectionnée: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">npm run restore -- --name selected</code></div>
        </div>
      </div>
    </div>
  );
}
