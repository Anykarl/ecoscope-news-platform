console.log('Démarrage du serveur...');

// Chargement des variables d'environnement
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Configuration du chemin vers le fichier .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');

console.log('Dossier courant:', process.cwd());
console.log('Chemin du fichier .env:', envPath);

// Vérification et création du fichier .env si nécessaire
try {
  if (!fs.existsSync(envPath)) {
    console.log('Création du fichier .env...');
    fs.writeFileSync(envPath, 'PORT=5002\nNODE_ENV=development\nVITE_API_URL=http://localhost:5002');
    console.log('Fichier .env créé avec succès');
  }
  
  // Chargement des variables d'environnement
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Erreur dotenv:', result.error);
    throw result.error;
  }
  
  console.log('✅ Fichier .env chargé avec succès');
  console.log('🔧 Configuration:');
  console.log('   - PORT:', process.env.PORT);
  console.log('   - NODE_ENV:', process.env.NODE_ENV);
  console.log('   - VITE_API_URL:', process.env.VITE_API_URL);
  
  // Vérification des variables requises
  const requiredVars = ['PORT', 'NODE_ENV'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Variables manquantes: ${missingVars.join(', ')}`);
  }
  
} catch (error) {
  console.error('❌ Erreur lors du chargement de la configuration:', error.message);
  process.exit(1);
}

// Autres imports
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { spawn } from 'child_process';
import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream } from 'node:stream/web';
import { Blob, File } from 'node:buffer';
import { fetch, Headers, FormData, Request, Response } from 'undici';
import { createServer } from 'net';
import ArticleStats from './models/ArticleStats.js';
import { createAdminRouter } from './routes/admin.js';
import { createStatsRouter } from './routes/stats.js';
import { createRefreshRouter } from './routes/refresh.js';

// Vérification des variables d'environnement requises
const requiredEnvVars = ['PORT', 'NODE_ENV'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Erreur: Les variables d'environnement suivantes sont manquantes: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

console.log('Configuration chargée:');
console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`- PORT: ${process.env.PORT}`);

// Polyfill Undici/Web: n'assigne que si manquant (évite TypeError si déjà définis)
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = TextDecoder;
if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = TextEncoder;
if (typeof globalThis.ReadableStream === 'undefined') globalThis.ReadableStream = ReadableStream;
if (typeof globalThis.TransformStream === 'undefined') globalThis.TransformStream = TransformStream;
if (typeof globalThis.Blob === 'undefined') globalThis.Blob = Blob;
if (typeof globalThis.File === 'undefined') globalThis.File = File;
if (typeof globalThis.fetch !== 'function') globalThis.fetch = fetch;
if (typeof globalThis.Headers === 'undefined') globalThis.Headers = Headers;
if (typeof globalThis.FormData === 'undefined') globalThis.FormData = FormData;
if (typeof globalThis.Request === 'undefined') globalThis.Request = Request;
if (typeof globalThis.Response === 'undefined') globalThis.Response = Response;

const app = express();
// CORS: authorize frontend origins and credentials
const allowedOrigins = [
  'http://localhost:3000',
  'https://ecoscope-news-platform.vercel.app'
];
app.use(cors({ 
  origin: allowedOrigins, 
  credentials: true 
}));
app.use(express.json());

// Robust error handling: prevent process crash on unhandled errors, log them instead
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err?.stack || err);
});

// Routers mounted later once dataDir/api and SSE are ready (see after backups endpoints)

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
});

const backupsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'backups');
const backupsIndexPath = path.join(backupsDir, 'index.json');
const backupsSelectedPath = path.join(backupsDir, 'selected.json');
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
// Expose uploads statics (for media saved by admin)
try {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
} catch {}
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

// Route racine
app.get('/', (req, res) => {
  res.json({ 
    message: 'Bienvenue sur l\'API EcoScope', 
    service: 'EcoScope Test Backend',
    version: '1.0.0',
    endpoints: ['/health', '/api/news', '/api/features', '/api/stats', '/api/admin', '/api/refresh']
  });
});

// Route test santé
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), service: 'EcoScope Test Backend' });
});

// Endpoint de configuration des fonctionnalités / rôles
app.get('/api/features', (_req, res) => {
  res.json({ summarizeEnabled: true, roles: ['viewer', 'admin'], defaultRole: 'viewer' });
});

// Liste des catégories (mise à jour, groupes a–i)
const categories = [
  // a. Climat et résilience
  "Changement climatique",
  "Résilience climatique Afrique",
  // d. Économie durable et innovations vertes
  "Économie circulaire",
  "Économie bleue",
  "Économie verte",
  "Startups vertes",
  "Hackathons verts Afrique",
  // e. Responsabilité sociale et leadership
  "RSE",
  "Leadership féminin & environnement",
  // f. Technologies et numérique responsables
  "Numérique responsable",
  "IA & environnement",
  // g. Éducation et sensibilisation
  "Programmes gratuits (MOOCs, bourses, séminaires, conférences)",
  "Journées mondiales durabilité",
  // h. Développement durable global
  "Objectifs de Développement Durable (ODD)",
  "Développement durable",
  // i. Tourisme durable
  "Écotourisme",
  "Pays à visiter",
  // --- ajouts demandés ---
  "Risques naturels",
  "Tsunamis",
  "Phénomènes météorologiques",
  "Géologie",
  "Catastrophes naturelles",
  "Prévention des risques",
];

// Minimal API for article operations (used by routers)
const api = {
  getArticles() { return articles.slice(); },
  findArticle(id) { return articles.find(a => a.id === Number(id)); },
  addArticle(payload) {
    const { title, content, lang, category, imageUrl, author, publishedAt, sourceUrl } = payload || {};
    if (!title || !content || !lang || !category) throw new Error('Champs requis: title, content, lang, category');
    const art = {
      id: nextId++,
      title,
      content,
      lang: String(lang).toLowerCase(),
      category,
      imageUrl: imageUrl || null,
      author: author || null,
      publishedAt: publishedAt || new Date().toISOString(),
      sourceUrl: sourceUrl || null,
    };
    articles.push(art);
    sseSend('news', { title: art.title, category: art.category });
    return art;
  },
  updateArticle(id, patch) {
    const a = articles.find(x => x.id === Number(id));
    if (!a) return null;
    Object.assign(a, patch || {});
    return a;
  },
  deleteArticle(id) {
    const idx = articles.findIndex(x => x.id === Number(id));
    if (idx === -1) return false;
    articles.splice(idx, 1);
    return true;
  },
  // Expose data directory for admin uploads
  getDataDir() {
    return dataDir;
  },
};

// (api helper will be defined after articles array)

// Groupes de catégories pour Cameroun / Afrique centrale / International
const categoryGroups = [
  {
    key: 'focus-cm',
    title: 'Focus Cameroun',
    items: [
      'Conservation communautaire au Cameroun',
      'Politiques environnementales (Cameroun)',
      'Impact minier & industries extractives (CM)',
      'Innovations agricoles locales (CM)',
      'Énergies renouvelables locales (CM)',
      'Santé environnementale (eau, air, pollution - CM)',
      'Initiatives jeunes & femmes (CM)'
    ]
  },
  {
    key: 'afrique-centrale',
    title: 'Afrique centrale',
    items: [
      'Déforestation & Bassin du Congo',
      'Biodiversité (Bassin du Congo)',
      'Politiques environnementales régionales',
      'Transition énergétique (Afrique centrale)',
      'Agriculture & sécurité alimentaire (AC)'
    ]
  },
  {
    key: 'international',
    title: 'International',
    items: [
      'COP & négociations climatiques',
      'Justice climatique',
      'Innovations technologiques vertes',
      'Économie circulaire',
      'Transitions agricoles (monde)'
    ]
  },
  {
    key: 'transverses',
    title: 'Thèmes transverses',
    items: [
      'Changement climatique',
      'Santé environnementale',
      'Eau et assainissement',
      'Pollution et santé environnementale',
      'Transition énergétique',
      'Agriculture et alimentation'
    ]
  }
];

// Liste plate complète pour validation et rétrocompatibilité
const categoriesAll = Array.from(new Set([ ...categories, ...categoryGroups.flatMap(g => g.items) ]));

// Route catégories
app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: categoriesAll,
    groups: categoryGroups,
    defaultCategory: "Changement climatique",
    refreshIntervalMinutes: 10,
    regions: [
      { key: 'focus-cm', label: 'Focus Cameroun' },
      { key: 'afrique-centrale', label: 'Afrique' },
      { key: 'international', label: 'International' }
    ],
    // Métadonnées supplémentaires pour filtres indépendants
    themes: [
      'Climat',
      'Biodiversité',
      'Économie durable',
      'Technologies',
      'Éducation',
      'Justice climatique',
      'Énergies',
      'Agriculture',
      'Santé environnementale',
      'Tourisme durable'
    ],
    regionsExpanded: [
      'Afrique centrale',
      'Afrique du Nord',
      'Afrique de l’Ouest',
      'Afrique de l’Est',
      'Europe',
      'Asie',
      'Amérique',
      'Océanie',
      'International'
    ],
    countries: [
      'Cameroun',
      'Gabon',
      'Congo',
      'RDC',
      'Tchad',
      'Centrafrique'
    ],
    /**
     * Mapping Région -> Pays (liste non-exhaustive mais réaliste)
     * Sources de référence: Nations Unies / Wikipédia (listes des pays par région)
     * Ces données servent le sélecteur dynamique région → pays côté frontend.
     */
    regionsCountries: {
      'Afrique centrale': [
        'Cameroun','Gabon','Congo','RDC','Tchad','Centrafrique','Guinée équatoriale','Sao Tomé-et-Principe','Angola'
      ],
      'Afrique du Nord': [
        'Maroc','Algérie','Tunisie','Libye','Égypte','Mauritanie','Soudan'
      ],
      'Afrique de l’Ouest': [
        'Sénégal','Côte d’Ivoire','Ghana','Nigeria','Mali','Burkina Faso','Niger','Guinée','Sierra Leone','Libéria','Bénin','Togo','Cap-Vert','Gambie','Guinée-Bissau'
      ],
      'Afrique de l’Est': [
        'Kenya','Tanzanie','Ouganda','Rwanda','Burundi','Éthiopie','Somalie','Soudan du Sud','Érythrée','Djibouti'
      ],
      'Europe': [
        'France','Allemagne','Espagne','Italie','Royaume-Uni','Portugal','Belgique','Pays-Bas','Suisse','Suède','Norvège','Danemark','Pologne','République tchèque','Autriche','Irlande','Finlande','Grèce','Hongrie','Roumanie','Bulgarie','Croatie','Serbie','Ukraine'
      ],
      'Asie': [
        'Chine','Inde','Japon','Corée du Sud','Indonésie','Malaisie','Thaïlande','Vietnam','Philippines','Pakistan','Bangladesh','Sri Lanka','Népal','Kazakhstan','Singapour','Arabie saoudite','Émirats arabes unis','Qatar','Jordanie','Israël','Turquie'
      ],
      'Amérique': [
        'États-Unis','Canada','Mexique','Brésil','Argentine','Colombie','Chili','Pérou','Venezuela','Équateur','Uruguay','Paraguay','Bolivie','Guatemala','Costa Rica','Panama','Cuba','République dominicaine','Honduras','Nicaragua','Haïti'
      ],
      'Océanie': [
        'Australie','Nouvelle-Zélande','Papouasie-Nouvelle-Guinée','Fidji','Samoa','Tonga','Vanuatu','Salomon'
      ],
      'International': []
    }
  });
});

// Articles bilingues (FR prioritaire) — ajout du champ catégorie, id, imageUrl
let nextId = 1;
const articles = [
  { id: nextId++, title: 'Impact du changement climatique', content: 'Analyse des effets sur les écosystèmes.', lang: 'fr', category: 'Changement climatique', imageUrl: null, author: 'Rédaction EcoScope', publishedAt: new Date().toISOString(), sourceUrl: null },
  { id: nextId++, title: 'Biodiversity protection', content: 'Local and international initiatives.', lang: 'en', category: 'Biodiversité (Bassin du Congo)', imageUrl: null, author: 'EcoScope Team', publishedAt: new Date().toISOString(), sourceUrl: null },
  { id: nextId++, title: 'Transition énergétique', content: 'Solutions durables pour les entreprises.', lang: 'fr', category: 'Transition énergétique', imageUrl: null, author: 'Rédaction EcoScope', publishedAt: new Date().toISOString(), sourceUrl: null }
];

// SSE: clients connectés
const sseClients = new Set();

function sseSend(event, data) {
  const line = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { /* noop */ }
  }
}

// Endpoint SSE pour synchro temps réel
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: ping\n` + `data: ${JSON.stringify({ t: Date.now() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Route articles
app.get('/api/news', (req, res) => {
  const { category } = req.query;
  let list = articles;

  if (category) {
    if (!categoriesAll.includes(category)) {
      return res.status(400).json({ success: false, message: 'Catégorie invalide', allowed: categoriesAll });
    }
    list = articles.filter(a => a.category === category);
  }

  // Poids FR>EN puis random, tout en évitant les doublons
  const weighted = [];
  list.forEach(a => {
    const w = a.lang === 'fr' ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(a);
  });
  const shuffled = weighted.sort(() => 0.5 - Math.random());
  const seen = new Set();
  const unique = [];
  for (const a of shuffled) {
    const key = a.title + '|' + a.category;
    if (!seen.has(key)) {
      unique.push(a);
      seen.add(key);
    }
  }
  // Ajouter un résumé court côté backend (gratuit): 140 caractères
  const withSummary = unique.map(a => ({
    ...a,
    summary: (a.content || '').slice(0, 140) + ((a.content || '').length > 140 ? '…' : ''),
  }));
  res.json(withSummary);
});

// Ajout dynamique d'articles
app.post('/api/news', (req, res) => {
  const { title, content, lang, category, imageUrl, author, publishedAt, sourceUrl } = req.body || {};

  if (!title || !content || !lang || !category) {
    return res.status(400).json({ success: false, message: 'Champs requis: title, content, lang (fr/en), category' });
  }
  const langOk = ['fr', 'en'].includes(String(lang).toLowerCase());
  if (!langOk) {
    return res.status(400).json({ success: false, message: "Lang doit être 'fr' ou 'en'" });
  }
  if (!categoriesAll.includes(category)) {
    return res.status(400).json({ success: false, message: 'Catégorie invalide', allowed: categoriesAll });
  }

  // Déduplication par sourceUrl si fourni
  if (sourceUrl) {
    const sameUrl = articles.some(a => a.sourceUrl && a.sourceUrl === sourceUrl);
    if (sameUrl) {
      return res.status(200).json({ success: true, duplicate: true, message: 'Article déjà présent (sourceUrl). Ignoré.' });
    }
  }

  // Déduplication simple: titre+catégorie
  const key = `${title}|${category}`;
  const exists = articles.some(a => `${a.title}|${a.category}` === key);
  if (exists) {
    return res.status(200).json({ success: true, duplicate: true, message: 'Article déjà présent (ignoré).' });
  }

  const article = {
    id: nextId++,
    title,
    content,
    lang: String(lang).toLowerCase(),
    category,
    imageUrl: imageUrl || null,
    author: author || null,
    publishedAt: publishedAt || new Date().toISOString(),
    sourceUrl: sourceUrl || null,
  };
  articles.push(article);
  // Notifier les clients en temps réel
  sseSend('news', { title, category });
  res.status(201).json({ success: true, article, count: articles.length });
});

// Endpoint de résumé (mock gratuit)
// Body accepté: { ids: number[] } ou { articles: [{ title, content, ... }] }
app.post('/api/summarize', (req, res) => {
  try {
    const { ids, articles: rawArticles } = req.body || {};
    let items = [];
    if (Array.isArray(ids) && ids.length > 0) {
      const set = new Set(ids.map(Number));
      items = articles.filter(a => set.has(a.id));
    } else if (Array.isArray(rawArticles) && rawArticles.length > 0) {
      items = rawArticles.map((a, i) => ({ id: a.id ?? i + 1, title: a.title || 'Sans titre', content: a.content || '', lang: a.lang || 'fr', category: a.category || '' }));
    }
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucun article fourni pour le résumé.' });
    }
    // Résumé simple: prendre les 40 premiers mots de chaque article et concaténer
    const parts = items.map(a => {
      const words = String(a.content || '').split(/\s+/).filter(Boolean).slice(0, 40).join(' ');
      return `• ${a.title}: ${words}${words.length ? '…' : ''}`;
    });
    const summary = parts.join('\n');
    res.json({ success: true, count: items.length, summary });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erreur du service de résumé (mock).', error: String(e?.message || e) });
  }
});

// --- Backups API (liste/sélection) ---
app.get('/api/backups', (_req, res) => {
  try {
    if (!fs.existsSync(backupsIndexPath)) return res.json({ success: true, backups: [] });
    const list = JSON.parse(fs.readFileSync(backupsIndexPath, 'utf-8'));
    res.json({ success: true, backups: Array.isArray(list) ? list : [] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Impossible de lire la liste des sauvegardes.', error: String(e?.message || e) });
  }
});

app.post('/api/backups/select', (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: 'Paramètre manquant: name' });
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(backupsSelectedPath, JSON.stringify({ name, selectedAt: new Date().toISOString() }, null, 2));
    res.json({ success: true, selected: name, hint: 'Pour restaurer, exécutez npm run restore' });
  } catch (e) {
    res.status(500).json({ success: false, message: "Impossible d'enregistrer la sauvegarde sélectionnée.", error: String(e?.message || e) });
  }
});

// --- Routers additionnels: refresh (scraper), stats, admin ---
// Helper pour lancer le scraper une fois (utilisé par /api/refresh)
function runScraperOnce() {
  return new Promise((resolve, reject) => {
    try {
      const proc = spawn(process.execPath, ['scraper.js'], { cwd: __dirname, stdio: 'inherit' });
      proc.on('exit', (code) => resolve(code ?? 0));
      proc.on('error', (e) => reject(e));
    } catch (e) {
      reject(e);
    }
  });
}

// Instancie le modèle de statistiques et monte les routes
const stats = new ArticleStats({ persistDir: path.join(dataDir, 'stats') });
app.use('/api/refresh', createRefreshRouter(runScraperOnce));
app.use('/api/stats', createStatsRouter(stats, api));
app.use('/api/admin', createAdminRouter(api));

// Gestion de port: fixé à 5002 par défaut (peut être surchargé par PORT)
// Note: On retire BACKEND_PORT pour éviter les décalages involontaires.
const PORT = process.env.PORT || 5002;
console.log('🔧 ENV:', { PORT, BACKEND_PORT: process.env.BACKEND_PORT, ENABLE_CRON: process.env.ENABLE_CRON });

function checkPort(port) {
  return new Promise((resolve) => {
    const tester = createServer()
      .once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') resolve(false); else resolve(true);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '0.0.0.0');
  });
}

async function startServer() {
  let port = Number(PORT) || 5002;
  let attempts = 0;
  while (attempts < 5) {
    // Vérifie si le port est libre
    // En cas d'occupation, tente le port suivant
    // Ajoute un petit délai pour laisser les processus se terminer
    // avant de réessayer
    // (utile après un clean-ports)
    // eslint-disable-next-line no-await-in-loop
    const free = await checkPort(port);
    if (free) break;
    console.log(`⚠️  Port ${port} occupé, essai ${attempts + 1}/5 → port ${port + 1}`);
    port += 1;
    attempts += 1;
  }

  app
    .listen(port, '0.0.0.0', () => console.log(`🌱 EcoScope Test Backend démarré sur le port ${port}`))
    .on('error', (err) => {
      console.error('❌ Erreur de démarrage:', err?.stack || err);
      process.exit(1);
    });
}

startServer();

// Planification gratuite via node-cron: toutes les 15–30 minutes (configurable)
// Env: SCRAPE_INTERVAL_MINUTES (15 à 30); défaut: 30
function getCronExpr() {
  const minutes = Number(process.env.SCRAPE_INTERVAL_MINUTES || 30);
  const safe = Number.isFinite(minutes) && minutes >= 15 && minutes <= 30 ? Math.round(minutes) : 30;
  if (safe === 30) return '*/30 * * * *';
  return `*/${safe} * * * *`;
}
// Guard cron: enable only if ENABLE_CRON === 'true' (default disabled)
try {
  const enableCron = String(process.env.ENABLE_CRON || '').toLowerCase() === 'true';
  if (enableCron) {
    const cronExpr = getCronExpr();
    console.log('⏲️  Cron activé avec intervalle:', cronExpr);
    cron.schedule(cronExpr, () => {
      try {
        console.log('⏰ Cron: lancement du scraper');
        const proc = spawn(process.execPath, ['scraper.js'], { cwd: process.cwd(), stdio: 'inherit' });
        proc.on('exit', (code) => console.log('✅ Scraper terminé avec code', code));
        proc.on('error', (e) => console.error('❌ Scraper spawn error:', e?.message || e));
      } catch (e) {
        console.error('❌ Cron handler error:', e?.message || e);
      }
    });
  } else {
    console.log('⏲️  Cron désactivé (ENABLE_CRON !== "true").');
  }
} catch (e) {
  console.error('❌ Erreur lors de la configuration du cron:', e?.message || e);
}
