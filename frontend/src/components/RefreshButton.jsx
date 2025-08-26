import React from 'react';

export default function RefreshButton() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002';
  const [status, setStatus] = React.useState('idle'); // idle|running|done|error
  const [lastCode, setLastCode] = React.useState(null);
  const [log, setLog] = React.useState([]);

  React.useEffect(() => {
    const ev = new EventSource(`${apiUrl}/api/events`);
    const onRefresh = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.status === 'started') { setStatus('running'); setLog((l)=>[...l, 'Scraper démarré…']); }
        if (data.status === 'completed') { setStatus('done'); setLastCode(data.code); setLog((l)=>[...l, `Terminé (code ${data.code})`]); }
        if (data.status === 'error') { setStatus('error'); setLog((l)=>[...l, `Erreur: ${data.error}`]); }
      } catch {}
    };
    ev.addEventListener('refresh', onRefresh);
    return () => { ev.removeEventListener('refresh', onRefresh); ev.close(); };
  }, [apiUrl]);

  const trigger = async () => {
    setStatus('running'); setLastCode(null); setLog([]);
    try {
      const res = await fetch(`${apiUrl}/api/refresh`, { method: 'POST' });
      const data = await res.json().catch(()=>({success:false}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Échec du déclenchement');
    } catch (e) {
      setStatus('error'); setLog((l)=>[...l, String(e.message || e)]);
    }
  };

  return (
    <div className="mt-6 p-4 rounded border bg-white dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <button onClick={trigger} disabled={status==='running'} className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${status==='running' ? 'bg-gray-300 text-gray-600 cursor-wait' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          {status==='running' && (<span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />)}
          Lancer le scraping
        </button>
        <span className="text-sm text-gray-600 dark:text-gray-300">
          Statut: {status}
          {lastCode!==null && ` (code ${lastCode})`}
        </span>
      </div>
      {log.length>0 && (
        <ul className="mt-3 text-xs text-gray-600 dark:text-gray-300 list-disc list-inside space-y-1">
          {log.map((l,i)=>(<li key={i}>{l}</li>))}
        </ul>
      )}
    </div>
  );
}
