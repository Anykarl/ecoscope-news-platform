import React, { useEffect, useState } from 'react';

export default function ArticleAdminForm() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002';
  const [pendingArticles, setPendingArticles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Simulation d'articles en attente. Remplacez par un vrai endpoint admin au besoin.
    setPendingArticles([
      {
        id: 'temp-1',
        title: 'Titre exemple',
        content: 'Contenu exemple...',
        lang: 'fr',
        category: 'Résilience climatique Afrique',
      },
    ]);
  }, []);

  function updateArticle(id, field, value) {
    setPendingArticles((arts) => arts.map(a => a.id === id ? { ...a, [field]: value } : a));
  }

  async function publishArticle(article) {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          content: article.content,
          lang: article.lang,
          category: article.category,
        }),
      });
      if (!res.ok) throw new Error('Erreur publication');
      alert(`Article publié : ${article.title}`);
      setPendingArticles((arts) => arts.filter(a => a.id !== article.id));
    } catch (e) {
      alert('Erreur lors de la publication : ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function deleteArticle(id) {
    setPendingArticles((arts) => arts.filter(a => a.id !== id));
  }

  const categories = [
    'Changement climatique','Résilience climatique Afrique','Carbone','Faune & climat','Flore & climat',
    'Risques inondations & alertes','Risques sécheresse & alertes','COP','Agendas internationaux climat',
    'Biodiversité (Bassin du Congo)','Évaluation environnementale au Cameroun','Étude d’Impact Environnementale et Sociale',
    'Audit environnemental au Cameroun','Gestion des déchets au Cameroun','Aménagement du territoire',
    'Transition énergétique','Transition écologique',
    'Économie circulaire','Économie bleue','Économie verte','Startups vertes','Hackathons verts Afrique',
    'RSE','Leadership féminin & environnement',
    'Numérique responsable','IA & environnement',
    'Programmes gratuits (MOOCs, bourses, séminaires, conférences)','Journées mondiales durabilité',
    'Objectifs de Développement Durable (ODD)','Développement durable',
    'Écotourisme','Pays à visiter',
  ];

  return (
    <div style={{ padding: '1rem', maxWidth: 800, margin: 'auto' }}>
      <h2>Administration articles scrappés</h2>
      {pendingArticles.length === 0 ? <p>Aucun article en attente.</p> : null}
      {pendingArticles.map(article => (
        <div key={article.id} style={{ borderBottom: '1px solid #ccc', marginBottom: 10, paddingBottom: 10 }}>
          <label>
            Titre<br />
            <input
              type="text" value={article.title}
              onChange={e => updateArticle(article.id, 'title', e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Contenu<br />
            <textarea
              rows={4} value={article.content}
              onChange={e => updateArticle(article.id, 'content', e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Langue<br />
            <select
              value={article.lang}
              onChange={e => updateArticle(article.id, 'lang', e.target.value)}
            >
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
            </select>
          </label>
          <label>
            Catégorie<br />
            <select
              value={article.category}
              onChange={e => updateArticle(article.id, 'category', e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div style={{ marginTop: 8 }}>
            <button disabled={loading} onClick={() => publishArticle(article)} style={{ marginRight: 8 }}>Publier</button>
            <button disabled={loading} onClick={() => deleteArticle(article.id)}>Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
}
