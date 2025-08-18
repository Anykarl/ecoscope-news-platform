import { useEffect, useState } from 'react';

export default function HomePage() {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [groups, setGroups] = useState([]); // from backend
  const [themes, setThemes] = useState([]);
  const [regionsExpanded, setRegionsExpanded] = useState([]);
  const [countries, setCountries] = useState([]);
  const [regionsCountries, setRegionsCountries] = useState({});
  const [defaultCategory, setDefaultCategory] = useState(null);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(10);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState(() => {
    try { return JSON.parse(localStorage.getItem('filters.categories') || '[]'); } catch { return []; }
  }); // multi-select with persistence
  const [selectedIds, setSelectedIds] = useState(new Set()); // for summarize
  const [userRole, setUserRole] = useState('viewer'); // viewer | admin (simulation)
  const [modalArticle, setModalArticle] = useState(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('filters.collapsed') || '{}'); } catch { return {}; }
  });
  const [langFilter, setLangFilter] = useState(() => localStorage.getItem('filters.lang') || 'all'); // all|fr|en
  const [themeFilter, setThemeFilter] = useState(() => localStorage.getItem('filters.theme') || 'all'); // all or a theme string
  const [regionFilter, setRegionFilter] = useState(() => localStorage.getItem('filters.region') || 'all');
  const [countryFilter, setCountryFilter] = useState(() => localStorage.getItem('filters.country') || 'all');
  const [articleQuery, setArticleQuery] = useState('');
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';

  const fetchNews = () => {
    const url = new URL(`${apiUrl}/api/news`);
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setArticles(data);
        setLastUpdated(new Date());
      })
      .catch(e => console.error('Erreur articles:', e));
  };

  useEffect(() => {
    fetchNews();
  }, [apiUrl]);

  useEffect(() => {
    fetch(`${apiUrl}/api/categories`)
      .then(r => r.json())
      .then(d => {
        setCategories(d.categories || []);
        setGroups(d.groups || []);
        setThemes(d.themes || []);
        setRegionsExpanded(d.regionsExpanded || []);
        setCountries(d.countries || []);
        setRegionsCountries(d.regionsCountries || {});
        if (d.defaultCategory) setDefaultCategory(d.defaultCategory);
        if (d.refreshIntervalMinutes) setRefreshIntervalMinutes(d.refreshIntervalMinutes);
      })
      .catch(e => console.error('Erreur catégories:', e));
  }, [apiUrl]);

  useEffect(() => {
    // Auto-refresh based on backend suggestion
    const ms = (refreshIntervalMinutes || 10) * 60 * 1000;
    const id = setInterval(() => {
      fetchNews();
    }, ms);
    return () => clearInterval(id);
  }, [refreshIntervalMinutes, apiUrl]);

  // Real-time sync via SSE
  useEffect(() => {
    const ev = new EventSource(`${apiUrl}/api/events`);
    const onNews = () => fetchNews();
    ev.addEventListener('news', onNews);
    ev.onerror = () => {
      // Let browser retry automatically; minimal handling
    };
    return () => {
      ev.removeEventListener('news', onNews);
      ev.close();
    };
  }, [apiUrl]);

  // Build groups from backend, filter by available categories and search
  const iconForGroup = (keyOrTitle) => {
    const k = String(keyOrTitle).toLowerCase();
    if (k.includes('cameroun')) return '🇨🇲';
    if (k.includes('afrique')) return '🌍';
    if (k.includes('international')) return '🌐';
    if (k.includes('transvers')) return '🧭';
    if (k.includes('climat')) return '☀️';
    if (k.includes('biodivers') || k.includes('congo')) return '🌿';
    if (k.includes('énergie')) return '⚡';
    if (k.includes('économie')) return '💹';
    return '🗂️';
  };

  const normalizedGroups = groups.map(g => ({
    key: g.key || g.title,
    title: g.title || g.key,
    items: (g.items || []).filter(c => categories.includes(c))
  }));

  const searchTerm = categorySearch.trim().toLowerCase();
  // Apply region/country/theme filters to the category list (UI-level filtering)
  const matchTheme = (cat) => {
    if (themeFilter === 'all') return true;
    const k = cat.toLowerCase();
    if (themeFilter === 'Climat') return /climat|cop|carbone|résilience/.test(k);
    if (themeFilter === 'Biodiversité') return /biodivers|faune|flore|congo/.test(k);
    if (themeFilter === 'Économie durable') return /économie|circulaire|verte|bleue/.test(k);
    if (themeFilter === 'Technologies') return /numérique|ia|techno|hackathon|startup/.test(k);
    if (themeFilter === 'Éducation') return /programmes gratuits|moocs|journées mondiales/.test(k);
    if (themeFilter === 'Énergies') return /énergie|renouvelable|transition/.test(k);
    if (themeFilter === 'Agriculture') return /agriculture|alimentation|sécurité alimentaire/.test(k);
    if (themeFilter === 'Santé environnementale') return /santé environnementale|pollution|eau|assainissement|air/.test(k);
    if (themeFilter === 'Tourisme durable') return /écotourisme|tourisme|visiter/.test(k);
    if (themeFilter === 'Justice climatique') return /justice climatique/.test(k);
    return true;
  };
  const matchRegion = (title) => {
    if (regionFilter === 'all') return true;
    const t = title.toLowerCase();
    if (regionFilter.toLowerCase().includes('cameroun')) return /cameroun/.test(t);
    if (regionFilter.toLowerCase().includes('afrique centrale')) return /afrique|congo|bassin du congo|ac/.test(t);
    if (regionFilter.toLowerCase().includes('international')) return /international|cop|monde|global/.test(t);
    return true;
  };
  const matchCountry = (cat) => {
    if (countryFilter === 'all') return true;
    const k = cat.toLowerCase();
    if (countryFilter.toLowerCase() === 'cameroun') return /cameroun|\(cm\)/.test(k);
    return k.includes(countryFilter.toLowerCase());
  };

  const filteredGroups = normalizedGroups
    .filter(g => matchRegion(g.title))
    .map(g => ({
      ...g,
      items: (searchTerm ? g.items.filter(i => i.toLowerCase().includes(searchTerm)) : g.items)
        .filter(i => matchTheme(i))
        .filter(i => matchCountry(i))
    }))
    .filter(g => g.items.length > 0);

  // Pays disponibles en fonction de la région sélectionnée
  const allCountriesFromMap = Array.from(new Set([].concat(...Object.values(regionsCountries || {}))));
  const availableCountries = regionFilter === 'all'
    ? (allCountriesFromMap.length ? allCountriesFromMap : countries)
    : (regionsCountries[regionFilter] || []);

  // Si le pays sélectionné n'appartient pas à la région actuelle, réinitialiser
  useEffect(() => {
    if (countryFilter !== 'all') {
      const list = regionFilter === 'all' ? availableCountries : (regionsCountries[regionFilter] || []);
      if (!list.includes(countryFilter)) {
        setCountryFilter('all');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionFilter, regionsCountries]);

  // Persist selections/collapsed/lang
  useEffect(() => {
    try { localStorage.setItem('filters.categories', JSON.stringify(selectedCategories)); } catch {}
  }, [selectedCategories]);
  useEffect(() => {
    try { localStorage.setItem('filters.collapsed', JSON.stringify(collapsed)); } catch {}
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem('filters.lang', langFilter); } catch {}
  }, [langFilter]);
  useEffect(() => {
    try { localStorage.setItem('filters.theme', themeFilter); } catch {}
  }, [themeFilter]);
  useEffect(() => {
    try { localStorage.setItem('filters.region', regionFilter); } catch {}
  }, [regionFilter]);
  useEffect(() => {
    try { localStorage.setItem('filters.country', countryFilter); } catch {}
  }, [countryFilter]);

  // Filtrage côté client: catégories explicites sinon catégories visibles via filtres thème/région/pays
  const visibleCategories = selectedCategories.length
    ? new Set(selectedCategories)
    : new Set(filteredGroups.flatMap(g => g.items));
  const byCategory = visibleCategories.size > 0
    ? articles.filter(a => visibleCategories.has(a.category))
    : articles;
  const byLang = langFilter === 'all' ? byCategory : byCategory.filter(a => a.lang === langFilter);
  const q = articleQuery.trim().toLowerCase();
  const filteredArticles = q
    ? byLang.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.author || '').toLowerCase().includes(q) ||
        (a.content || '').toLowerCase().includes(q)
      )
    : byLang;

  const toggleCategory = (c) => {
    setSelectedCategories(prev => {
      if (prev.includes(c)) return prev.filter(x => x !== c);
      return [...prev, c];
    });
  };

  const clearFilters = () => setSelectedCategories([]);
  const toggleGroup = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleSelectedId = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
  };

  const summarizeSelected = async () => {
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const res = await fetch(`${apiUrl}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Erreur résumé');
      // Afficher le résultat dans un modal simple
      setModalArticle({
        title: `Résumé (${data.count} article${data.count>1?'s':''})`,
        content: data.summary,
        lang: 'fr',
        category: 'Résumé',
      });
    } catch (e) {
      alert('Erreur du service de résumé: ' + e.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl font-bold text-emerald-700">EcoScope</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Rôle:</label>
          <select value={userRole} onChange={e=>setUserRole(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="viewer">Lecteur</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>
      </div>

      {/* Dynamic seasonal background (non-intrusive) */}
      <SeasonalBackground theme={themeFilter} />

      <div className="flex flex-col md:flex-row gap-4 relative">
        {/* Sidebar catégories */
        }
        <aside className="md:w-72 w-full">
          <div className="border border-gray-200 rounded-lg bg-white shadow-sm dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center gap-2 p-3 border-b dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Catégories</h2>
              <button onClick={clearFilters} className="ml-auto text-xs text-emerald-700 hover:underline">Effacer</button>
            </div>
            {/* Filtres indépendants: thème, région, pays */}
            <div className="grid grid-cols-1 gap-2 p-3 border-b dark:border-gray-700">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="themeFilter">Thème</label>
                <select id="themeFilter" value={themeFilter} onChange={e=>setThemeFilter(e.target.value)} className="ml-auto border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
                  <option value="all">Tous</option>
                  {themes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="regionFilter">Région</label>
                <select id="regionFilter" value={regionFilter} onChange={e=>setRegionFilter(e.target.value)} className="ml-auto border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600">
                  <option value="all">Toutes</option>
                  {regionsExpanded.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="countryFilter">Pays</label>
                <select id="countryFilter" value={countryFilter} onChange={e=>setCountryFilter(e.target.value)} className="ml-auto border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600" disabled={availableCountries.length===0}>
                  <option value="all">Tous</option>
                  {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {/* Recherche catégories */}
            <div className="p-3 border-b dark:border-gray-700">
              <div className="relative">
                <input
                  value={categorySearch}
                  onChange={e=>setCategorySearch(e.target.value)}
                  placeholder="Rechercher une catégorie…"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                  aria-label="Recherche catégories"
                />
                {categorySearch && (
                  <button
                    onClick={()=>setCategorySearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-300"
                    aria-label="Effacer la recherche"
                  >×</button>
                )}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto p-3 space-y-3">
              {filteredGroups.map(({ key, title, items }) => (
                <div key={key} className="border-b last:border-0 pb-2 dark:border-gray-700">
                  <button
                    onClick={()=>toggleGroup(key)}
                    aria-expanded={!collapsed[key]}
                    className="w-full flex items-center justify-between text-left text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{iconForGroup(title)}</span>
                      {title}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{collapsed[key] ? '▼' : '▲'}</span>
                  </button>
                  {!collapsed[key] && (
                    <ul className="mt-2 space-y-1">
                      {items.map((c) => (
                        <li key={c} className="flex items-center gap-2">
                          <input
                            id={`cat-${c}`}
                            type="checkbox"
                            className="accent-emerald-600"
                            checked={selectedCategories.includes(c)}
                            onChange={()=>toggleCategory(c)}
                          />
                          <label htmlFor={`cat-${c}`} className="text-sm text-gray-800 dark:text-gray-200 cursor-pointer">{c}</label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {lastUpdated && <div>Dernière mise à jour: {lastUpdated.toLocaleTimeString()}</div>}
            {defaultCategory && <div>Catégorie par défaut: {defaultCategory}</div>}
          </div>
        </aside>

        {/* Contenu principal */}
        <main className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Articles</h2>
            <div className="flex items-center gap-2">
              {/* Filtre langue */}
              <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="langFilter">Langue</label>
              <select
                id="langFilter"
                value={langFilter}
                onChange={e=>setLangFilter(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
              >
                <option value="all">Bilingue (FR+EN)</option>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
              </select>
              {/* Recherche articles */}
              <div className="relative ml-2">
                <input
                  value={articleQuery}
                  onChange={(e)=>setArticleQuery(e.target.value)}
                  placeholder="Rechercher articles (titre, auteur, contenu)…"
                  className="w-56 md:w-72 rounded-md border px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                  aria-label="Recherche articles"
                />
                {articleQuery && (
                  <button onClick={()=>setArticleQuery('')} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-300">×</button>
                )}
              </div>
              <button onClick={fetchNews} className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 transition text-sm">Rafraîchir</button>
              <button
                onClick={summarizeSelected}
                disabled={userRole!=='admin' || selectedIds.size===0}
                className={`px-3 py-2 rounded-md text-sm ${userRole==='admin' && selectedIds.size>0 ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'}`}
                title={userRole!=='admin' ? 'Réservé aux administrateurs' : (selectedIds.size===0 ? 'Sélectionnez des articles' : 'Générer un résumé')}
              >
                Résumer ({selectedIds.size})
              </button>
            </div>
          </div>

          {filteredArticles.length === 0 ? (
            <p className="text-gray-600">Aucun article disponible pour le moment</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredArticles.map((a) => (
                <li key={a.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm flex flex-col dark:bg-gray-800 dark:border-gray-700">
                  <div className="relative">
                    <img
                      src={a.imageUrl || 'https://via.placeholder.com/640x360?text=EcoScope'}
                      alt={a.title}
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                    <div className="absolute top-2 left-2 text-xs bg-white/90 px-2 py-0.5 rounded border border-gray-200 dark:bg-gray-800/90 dark:border-gray-600 dark:text-gray-100">{a.lang.toUpperCase()}</div>
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={()=>setModalArticle(a)}
                        className="text-left font-medium text-gray-900 dark:text-gray-100 line-clamp-2 hover:underline"
                        title={a.title}
                        aria-label={`Ouvrir ${a.title}`}
                      >
                        {a.title}
                      </button>
                      <input type="checkbox" className="accent-emerald-600 mt-1" checked={selectedIds.has(a.id)} onChange={()=>toggleSelectedId(a.id)} title="Sélectionner pour résumer" />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <em>{a.category}</em>
                      {a.author && <span>• {a.author}</span>}
                      {a.publishedAt && <span>• {fmtDate(a.publishedAt)}</span>}
                    </div>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 line-clamp-3">{a.summary || a.content}</p>
                    <div className="mt-auto pt-3">
                      <button
                        onClick={()=>setModalArticle(a)}
                        className="text-sm text-emerald-700 hover:text-emerald-800 hover:underline"
                        aria-label={`Ouvrir ${a.title}`}
                      >
                        Ouvrir
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      {/* Modal d'article / Résumé */}
      {modalArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setModalArticle(null)}></div>
          <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-4 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3 border-b pb-2 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{modalArticle.title}</h3>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {modalArticle.author && <span>{modalArticle.author}</span>}
                  {modalArticle.publishedAt && <span>• {fmtDate(modalArticle.publishedAt)}</span>}
                  {modalArticle.sourceUrl && (
                    <a href={modalArticle.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                      Source ↗
                    </a>
                  )}
                </div>
              </div>
              <button onClick={()=>setModalArticle(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white">✕</button>
            </div>
            {modalArticle.imageUrl && (
              <img src={modalArticle.imageUrl} alt="" className="mt-3 w-full max-h-80 object-cover rounded" />
            )}
            <div className="mt-3 whitespace-pre-wrap text-gray-800 dark:text-gray-200 text-sm">{modalArticle.content}</div>
            <div className="mt-4 flex justify-end">
              <button onClick={()=>setModalArticle(null)} className="px-3 py-2 rounded-md text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">Retour à la liste</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Lightweight background component using external images to avoid bundling
function SeasonalBackground({ theme }) {
  const month = new Date().getMonth(); // 0-11
  const season = (m => (m<=1||m===11)?'winter':(m<=4?'spring':(m<=7?'summer':'autumn')))(month);
  const pick = (map) => map[theme] || map.default;
  const images = {
    winter: pick({
      Climat: 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?q=80&w=1600&auto=format&fit=crop',
      Biodiversité: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?q=80&w=1600&auto=format&fit=crop',
      default: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1600&auto=format&fit=crop'
    }),
    spring: pick({
      Climat: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop',
      Biodiversité: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=1600&auto=format&fit=crop',
      default: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1600&auto=format&fit=crop'
    }),
    summer: pick({
      Climat: 'https://images.unsplash.com/photo-1501426026826-31c667bdf23d?q=80&w=1600&auto=format&fit=crop',
      Biodiversité: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?q=80&w=1600&auto=format&fit=crop',
      default: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=1600&auto=format&fit=crop'
    }),
    autumn: pick({
      Climat: 'https://images.unsplash.com/photo-1476041800959-2f6bb412c8ce?q=80&w=1600&auto=format&fit=crop',
      Biodiversité: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1600&auto=format&fit=crop',
      default: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1600&auto=format&fit=crop'
    })
  };
  const url = images[season];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${url})` }}
      />
      <div className="absolute inset-0 bg-white/60 dark:bg-black/60" />
    </div>
  );
}
