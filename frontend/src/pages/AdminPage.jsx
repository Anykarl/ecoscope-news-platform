import React from 'react';
import ArticleAdminForm from '../components/ArticleAdminForm.jsx';
import StatisticsDashboard from '../components/StatisticsDashboard.jsx';
import RefreshButton from '../components/RefreshButton.jsx';

// Hook pour vérifier l'état de l'API
const useApiHealth = () => {
  const [apiStatus, setApiStatus] = React.useState('checking');

  React.useEffect(() => {
    const checkApi = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002';
        const response = await fetch(`${apiUrl}/health`);
        setApiStatus(response.ok ? 'online' : 'error');
      } catch {
        setApiStatus('error');
      }
    };

    checkApi();
    const interval = setInterval(checkApi, 30000);
    return () => clearInterval(interval);
  }, []);

  return apiStatus;
};

// Composant indicateur d'état API
const ApiStatusIndicator = () => {
  const apiStatus = useApiHealth();
  if (apiStatus === 'checking') return null;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
      apiStatus === 'online' 
        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    }`}>
      <span>{apiStatus === 'online' ? '✅' : '❌'}</span>
      API: {apiStatus === 'online' ? 'Connectée' : 'Déconnectée'}
      {apiStatus !== 'online' && (
        <button 
          onClick={() => window.location.reload()}
          className="ml-2 text-xs underline hover:no-underline"
        >
          Recharger
        </button>
      )}
    </div>
  );
};

export default function AdminPage() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002';
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">EcoScope Admin</h1>
        <ApiStatusIndicator />
      </div>
      <div className="grid gap-6">
        <ArticleAdminForm />
        <RefreshButton />
        <StatisticsDashboard />
      </div>

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
