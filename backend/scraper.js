// Scraper minimal viable pour EcoScope (ESM)
// - Sources: Le Monde (Planète, FR), National Geographic (Environment, EN), BBC (Science & Environment, EN)
// - Extraction: liens récents (<=5 par source), titre + URL (extrait court optionnel)
// - Injection: POST vers API locale /api/news
// Remarques: code simple et commenté pour validation pipeline cron → scraper → API → SSE

import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { ProxyAgent } from 'proxy-agent';
import { promises as dns } from 'dns';

// Forcer IPv4 pour éviter ::1
// Utilise ECOSCOPE_API_URL si fourni, sinon fallback vers backend par défaut en 5002
const API_URL = process.env.ECOSCOPE_API_URL || 'http://127.0.0.1:5002/api/news';
const UA = process.env.SCRAPER_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0 EcoScopeScraper/1.2';

// --- Proxy support (entreprise) ---
// Respecte HTTP_PROXY / HTTPS_PROXY / NO_PROXY. Si défini, on branche un Agent proxy.
let httpAgent;
let httpsAgent;
try {
  const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || process.env.https_proxy;
  if (proxyEnv) {
    const agent = new ProxyAgent(proxyEnv);
    httpAgent = agent;
    httpsAgent = agent;
    console.log('🌐 Proxy détecté via env:', proxyEnv.replace(/\S{3,}:(\/\/)?/g, '***://'));
  }
} catch (e) {
  console.warn('Proxy init warning:', e?.message || e);
}

const BASE_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS || 60000);
const REQ_OPTS = {
  timeout: BASE_TIMEOUT_MS,
  headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8' },
  proxy: false, // important pour utiliser les agents
  httpAgent,
  httpsAgent,
};
// Plafond global d'articles enrichis (meta + image) par session
// Configurable via ENRICH_CAP ou MAX_ENRICH (défaut 30)
const ENRICH_CAP = Number(process.env.ENRICH_CAP || process.env.MAX_ENRICH || 30);
const MAX_PER_SOURCE = Number(process.env.MAX_PER_SOURCE || 30); // plafond par source
const VIDEO_ENABLED = String(process.env.VIDEO_ENABLED || 'true').toLowerCase() !== 'false';
const VIDEO_KEYWORDS = String(process.env.VIDEO_KEYWORDS || 'climat,climate,environment,environnement,énergie,energie,pollution,biodiversité,biodiversity,eau,water,agriculture,canicule,heatwave,incendie,wildfire,nucléaire,nuclear,plastique,plastic').split(',').map(s => s.trim()).filter(Boolean);

// Concurrence contrôlée et délais polis entre lots
const MAX_ENRICH_CONCURRENCY = Number(process.env.MAX_ENRICH_CONCURRENCY || 4);
const MAX_POST_CONCURRENCY = Number(process.env.MAX_POST_CONCURRENCY || process.env.POST_CONCURRENCY || 3);
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS || process.env.POST_BATCH_DELAY_MS || 1000);
const POST_THROTTLE_MS = Number(process.env.POST_THROTTLE_MS || 0); // délai par article (en plus du délai entre lots)

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Instance axios dédiée aux GET/POST avec timeouts 60s et proxy/UA
const http = axios.create({
  timeout: BASE_TIMEOUT_MS,
  headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8' },
  proxy: false,
  httpAgent,
  httpsAgent,
});
const axiosPost = axios.create({
  timeout: Number(process.env.POST_TIMEOUT_MS || BASE_TIMEOUT_MS),
  timeoutErrorMessage: 'Timeout dépassé lors de la publication',
  headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
  proxy: false,
  httpAgent,
  httpsAgent,
});

// Intercepteurs pour journalisation détaillée
function attachLoggingInterceptors(instance, name) {
  instance.interceptors.request.use((config) => {
    const target = `${config.method?.toUpperCase()} ${config.url}`;
    console.log(`➡️ [${name}]`, target, {
      timeout: config.timeout,
      proxy: Boolean(proxyActive()),
    });
    return config;
  });
  instance.interceptors.response.use(
    (res) => {
      console.log(`⬅️ [${name}] ${res.status} ${res.config?.url}`);
      return res;
    },
    (error) => {
      const url = error?.config?.url;
      const code = error?.code || error?.response?.status;
      console.warn(`❗ [${name}] échec ${code} ${url}:`, error?.message);
      return Promise.reject(error);
    }
  );
}

function proxyActive() {
  return Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || process.env.https_proxy);
}

attachLoggingInterceptors(http, 'GET');
attachLoggingInterceptors(axiosPost, 'POST');

// --- Mode test de connectivité (optionnel) ---
if (process.argv.includes('--test-connectivity')) {
  console.log('=== MODE TEST DE CONNECTIVITÉ ===');
  try {
    await connectivityDiagnostics();
    console.log('=== TEST TERMINÉ ===');
    process.exit(0);
  } catch (error) {
    console.error('=== TEST ÉCHOUÉ ===', error?.message || error);
    process.exit(1);
  }
}

// Logging d'erreur détaillé avec contexte (HTTP status, data, stack)
function logErrorWithContext(error, context = {}) {
  try {
    const msg = error?.message || String(error);
    console.error('❌ ERREUR:', msg);
    console.error('📋 Contexte:', JSON.stringify(context));
    if (error?.response) {
      const status = error.response.status;
      let data;
      try { data = JSON.stringify(error.response.data); } catch { data = String(error.response.data); }
      console.error('📡 Statut HTTP:', status);
      console.error('📦 Données de réponse:', data);
    }
    if (error?.stack) {
      console.error('🔍 Stack trace:', error.stack);
    }
  } catch (e) {
    // Fallback minimal
    console.error('❌ ERREUR (fallback log):', error?.message || String(error));
  }
}

// --- New sources: IPCC, UNEP, ScienceDaily (Climate), Phys.org (Climate change), YouTube API ---
// Helper GET avec retry/backoff centralisé
async function getWithRetry(url, opts = REQ_OPTS, retries = 3, baseDelay = 1000) {
  return retryWithBackoff(() => http.get(url, { ...REQ_OPTS, ...(opts || {}) }), retries, baseDelay);
}
async function scrapeIPCC() {
  const base = 'https://www.ipcc.ch/';
  const news = 'https://www.ipcc.ch/news/';
  try {
    const { data } = await getWithRetry(news);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    $('a[href*="/news/"] , a.card-link').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      const title = sanitizeTitle($(el).text());
      if (!href || !/ipcc\.ch\//.test(href)) { skipped.push({ title, href, reason: 'invalid-href' }); return; }
      if (!/\/news\//.test(href)) { skipped.push({ title, href, reason: 'non-news' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    return { results, skipped };
  } catch (e) {
    console.warn('IPCC: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: news, reason: 'error:' + e.message }] };
  }
}

async function scrapeUNEP() {
  const base = 'https://www.unep.org/';
  const news = 'https://www.unep.org/news-and-stories';
  try {
    const { data } = await getWithRetry(news);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    $('a[href*="/news-and-stories/"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      const title = sanitizeTitle($(el).text());
      if (!href || !/unep\.org\//.test(href)) { skipped.push({ title, href, reason: 'invalid-href' }); return; }
      if (/\/events\//.test(href)) { skipped.push({ title, href, reason: 'event' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    return { results, skipped };
  } catch (e) {
    console.warn('UNEP: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: news, reason: 'error:' + e.message }] };
  }
}

async function scrapeScienceDaily() {
  const base = 'https://www.sciencedaily.com';
  const url = base + '/news/earth_climate/climate/';
  try {
    const { data } = await getWithRetry(url);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    $('a[href^="/releases/"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      const title = sanitizeTitle($(el).text());
      if (!href || !/sciencedaily\.com\//.test(href)) { skipped.push({ title, href, reason: 'invalid-href' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    return { results, skipped };
  } catch (e) {
    console.warn('ScienceDaily: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: url, reason: 'error:' + e.message }] };
  }
}

async function scrapePhysOrg() {
  const base = 'https://phys.org';
  const url = base + '/environment-news/climate-change/';
  try {
    const { data } = await getWithRetry(url);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    $('a[href*="/news/"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      const title = sanitizeTitle($(el).text());
      if (!href || !/phys\.org\//.test(href)) { return; }
      if (!/\/news\//.test(href)) { return; }
      if (isBadTitle(title)) { return; }
      if (seen.has(href)) { return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    return { results, skipped };
  } catch (e) {
    console.warn('Phys.org: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: url, reason: 'error:' + e.message }] };
  }
}

// Optional YouTube Data API v3 integration (requires env: YT_API_KEY and YT_CHANNEL_ID)
async function scrapeYouTubeAPI() {
  const apiKey = process.env.YT_API_KEY;
  const channelId = process.env.YT_CHANNEL_ID; // e.g., for @LeHuffPost once resolved
  const maxResults = Number(process.env.YT_MAX_RESULTS || 10);
  if (!apiKey || !channelId) {
    console.log('YouTube API non configurée (YT_API_KEY/YT_CHANNEL_ID manquants) → skip');
    return { results: [], skipped: [] };
  }
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${encodeURIComponent(apiKey)}&channelId=${encodeURIComponent(channelId)}&part=snippet,id&order=date&type=video&maxResults=${maxResults}`;
    const { data } = await getWithRetry(searchUrl, { timeout: BASE_TIMEOUT_MS });
    const results = [];
    const skipped = [];
    for (const item of (data.items || [])) {
      const vid = item.id?.videoId;
      const title = sanitizeTitle(item.snippet?.title || '');
      if (!vid || isBadTitle(title) || !isVideoRelevant(title)) { skipped.push({ title, href: '', reason: 'filtered' }); continue; }
      const url = `https://www.youtube.com/watch?v=${vid}`;
      results.push({ title, url, lang: 'fr', category: 'Vidéos' });
    }
    return { results, skipped };
  } catch (e) {
    console.warn('YouTube API: erreur:', e.message);
    return { results: [], skipped: [{ title: '', href: 'youtube-api', reason: 'error:' + e.message }] };
  }
}
// end helpers

// Réessai avec backoff exponentiel (transient uniquement: 5xx/429 ou erreurs réseau)
async function retryWithBackoff(operation, maxRetries = 3, baseDelay = 1000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isNetwork = !status;
      const isTransient = isNetwork || status >= 500 || status === 429 || status === 408;
      if (!isTransient) {
        // Erreur permanente (ex: 400/422 validation): ne pas réessayer
        throw err;
      }
      if (attempt === maxRetries) {
        console.error(`❌ Échec après ${maxRetries} tentatives`);
        throw err;
      }
      // Si 429, respecter Retry-After si disponible
      let delayMs = baseDelay * Math.pow(2, attempt - 1);
      const retryAfter = err?.response?.headers?.['retry-after'] || err?.response?.headers?.['Retry-After'];
      if (status === 429 && retryAfter) {
        const ra = Number(retryAfter);
        if (!Number.isNaN(ra) && ra > 0) {
          delayMs = Math.max(delayMs, ra * 1000);
        }
      }
      console.warn(`⚠️ Tentative ${attempt} échouée (status=${status || 'network'}), nouvel essai dans ${delayMs}ms...`);
      await delay(delayMs);
    }
  }
  // Ne devrait pas arriver
  throw lastErr;
}

// Validation préalable (évite les erreurs 4xx inutiles)
function validatePayload(p) {
  const missing = [];
  if (!p?.title) missing.push('title');
  if (!p?.content) missing.push('content');
  if (!p?.sourceUrl) missing.push('sourceUrl');
  if (!p?.category) missing.push('category');
  if (missing.length) {
    const err = new Error('Champs manquants: ' + missing.join(', '));
    err.code = 'VALIDATION_PAYLOAD_MISSING';
    throw err;
  }
  if (String(p.title).trim().length < 5) {
    const err = new Error('Titre trop court');
    err.code = 'VALIDATION_TITLE_SHORT';
    throw err;
  }
  if (String(p.content).trim().length < 5) {
    const err = new Error('Content trop court');
    err.code = 'VALIDATION_CONTENT_SHORT';
    throw err;
  }
}

async function mapWithConcurrency(arr, limit, fn, betweenBatchesDelay = BATCH_DELAY_MS) {
  const out = [];
  for (let i = 0; i < arr.length; i += limit) {
    const batch = arr.slice(i, i + limit);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
    if (i + limit < arr.length && betweenBatchesDelay > 0) await delay(betweenBatchesDelay);
  }
  return out;
}

async function scrapeVideos() {
  if (!VIDEO_ENABLED) return { results: [], skipped: [] };
  const sources = [
    { name: 'LeMondeVideo', base: 'https://www.lemonde.fr/videos/', lang: 'fr', sel: 'a[href*="/videos/"]' },
    { name: 'HuffPostVideoFR', base: 'https://www.huffingtonpost.fr/videos/', lang: 'fr', sel: 'a[href*="/videos/"]' },
  ];
  const all = [];
  const allSkipped = [];
  for (const src of sources) {
    try {
      const { data } = await getWithRetry(src.base);
      const $ = cheerio.load(data);
      const seen = new Set();
      $(src.sel).each((_, el) => {
        if (all.length >= MAX_PER_SOURCE) return false;
        const href = normalizeUrl($(el).attr('href'), src.base);
        if (!href) { allSkipped.push({ title: '', href, reason: 'invalid-href' }); return; }
        if (/\/live\//i.test(href)) { allSkipped.push({ title: '', href, reason: 'live' }); return; }
        const title = sanitizeTitle($(el).text());
        if (!title || isBadTitle(title)) { allSkipped.push({ title, href, reason: 'bad-title' }); return; }
        if (!isVideoRelevant(title)) { allSkipped.push({ title, href, reason: 'video-not-whitelisted' }); return; }
        if (seen.has(href)) { allSkipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
        all.push({ title, url: href, lang: src.lang, category: 'Vidéos' });
      });
      console.log(`SRC_SUMMARY: ${src.name} collected=${seen.size}`);
    } catch (e) {
      console.warn(`${src.name}: erreur scrape:`, e.message);
      allSkipped.push({ title: '', href: src.base, reason: 'error:' + e.message });
    }
  }
  return { results: all, skipped: allSkipped };
}

function normalizeUrl(href, base) {
  try {
    if (!href) return null;
    if (href.startsWith('http')) return href;
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function sanitizeTitle(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeForDedupTitle(text) {
  return sanitizeTitle(text)
    .toLowerCase()
    .replace(/["'“”‘’\-–—_:;.,!?()\[\]\{\}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDomainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Filtre étendu pour titres parasites/navigation/pagination (mots isolés et expressions)
const BAD_TITLE_RX = new RegExp([
  '\\bhome\\b',
  '\\bmenu\\b',
  'more menu',
  'close menu',
  'skip to content',
  '\\bfooter\\b',
  '\\bsubscribe\\b',
  'sign in',
  'log ?in',
  '\\bcookies?\\b',
  '\\bconsent\\b',
  // important: évite de filtrer "research" (on cible uniquement le mot isolé "search")
  '\\bsearch\\b',
  'next page',
  '\\bpagination\\b'
].join('|'), 'i');
function isBadTitle(title) {
  const t = sanitizeTitle(title).toLowerCase();
  // Assouplir la longueur minimale pour éviter d'écarter certains titres courts mais valides
  if (!t || t.length < 5) return true;
  if (BAD_TITLE_RX.test(t)) return true;
  return false;
}

function mapCategory(title) {
  const t = (title || '').toLowerCase();
  const has = (...keys) => keys.some(k => t.includes(k));

  // API categories only
  if (has('climate', 'climat', 'réchauff', 'warming', 'greenhouse', 'canicule', 'heatwave')) return 'Climat';
  if (has('biodivers', 'wildlife', 'espèce', 'faune', 'flore', 'habitat', 'ecosystem', 'conservation')) return 'Biodiversité';
  if (has('sustainable development', 'développement durable', 'durable')) return 'Développement durable';
  if (has('énergie', 'energie', 'renewable', 'solar', 'photovolta', 'wind', 'éolien', 'hydrogen', 'hydrogène', 'battery', 'batterie', 'grid', 'électri', 'electr')) return 'Énergie';
  if (has('pollution', 'plastique', 'microplastic', 'smog', 'qualité de l\'air', 'air quality', 'déchet', 'waste')) return 'Pollution';
  if (has('agriculture', 'agricole', 'farmer', 'crop', 'récolte', 'pesticide', 'fertilizer', 'fertilisant', 'soil', 'sol', 'irrigation', 'livestock', 'élevage', 'alimentation', 'food')) return 'Agriculture';
  if (has('eau', 'water', 'river', 'rivière', 'flood', 'inondation', 'drought', 'sécheresse', 'aquifer', 'aquifère')) return 'Eau';
  if (has('économie circulaire', 'circular economy', 'recycl', 'réutilis')) return 'Économie circulaire';
  if (has('santé', 'health', 'maladie', 'toxic', 'toxique')) return 'Santé environnementale';
  if (has('urban', 'urbain', 'ville', 'urbanisme', 'aménagement', 'zoning')) return 'Urbanisme durable';
  if (has('mobilité', 'transport', 'vélo', 'bus', 'train', 'transit', 'voiture électrique', 'vehicule électrique', 'e-mobility')) return 'Mobilité durable';
  if (has('technologies vertes', 'green tech', 'cleantech', 'cleantechs', 'innovation', 'innovant', 'startup', 'start-up')) return 'Technologies vertes';
  if (has('politique', 'policy', 'réglement', 'régulation', 'loi', 'gouvernement', 'gouvernance')) return 'Politique environnementale';
  if (has('conservation', 'protected area', 'aire protégée', 'réserve', 'parc national')) return 'Conservation';
  if (has('justice climatique', 'justice', 'equity', 'inequality', 'inégalité')) return 'Justice climatique';
  if (has('éducation', 'education', 'awareness', 'sensibilisation', 'pédagogie')) return 'Éducation à l\'environnement';

  // Fallback
  return 'Développement durable';
}

// Catégories autorisées (sera synchronisée avec l'API) + catégorie par défaut dynamique
let ALLOWED_CATEGORIES = new Set([
  'Changement climatique',
  'Économie circulaire',
  'Économie bleue',
  'Économie verte',
  'Startups vertes',
  'Hackathons verts Afrique',
  'RSE',
  'Leadership féminin & environnement',
  'Numérique responsable',
  'IA & environnement',
  'Programmes gratuits (MOOCs, bourses, séminaires, conférences)',
  'Journées mondiales durabilité',
  'Objectifs de Développement Durable (ODD)',
  'Développement durable',
  'Écotourisme',
  'Pays à visiter',
  'Risques naturels',
  'Tsunamis',
  'Phénomènes météorologiques',
  'Géologie',
  'Catastrophes naturelles',
  'Prévention des risques',
  // Group items (extraits courants)
  'Changement climatique',
  'Santé environnementale',
  'Eau et assainissement',
  'Pollution et santé environnementale',
  'Transition énergétique',
  'Agriculture et alimentation',
  'Biodiversité (Bassin du Congo)',
  'Politiques environnementales régionales',
  'Innovations technologiques vertes',
]);
let DEFAULT_CATEGORY = 'Changement climatique';

function getCategoriesUrl() {
  const env = process.env.ECOSCOPE_API_URL;
  if (env) {
    if (/\/api\/news/.test(env)) return env.replace(/\/api\/news.*$/, '/api/categories');
    return env.replace(/\/$/, '') + '/api/categories';
  }
  return 'http://127.0.0.1:5002/api/categories';
}

async function syncCategoriesFromAPI() {
  try {
    const url = getCategoriesUrl();
    const { data } = await http.get(url, { timeout: 15000 });
    // Backend renvoie un objet { success, categories, groups, defaultCategory, ... }
    const list = Array.isArray(data) ? data : Array.isArray(data?.categories) ? data.categories : null;
    if (Array.isArray(list) && list.length) {
      ALLOWED_CATEGORIES = new Set(list.map(String));
      if (data && typeof data.defaultCategory === 'string' && data.defaultCategory.trim()) {
        DEFAULT_CATEGORY = data.defaultCategory.trim();
      }
      console.log('✅ Catégories synchronisées depuis l\'API:', list.length, 'items. Default =', DEFAULT_CATEGORY);
    } else {
      console.warn('⚠️ Réponse catégories inattendue, conservation de la liste locale');
    }
  } catch (e) {
    console.warn('❗ Impossible de synchroniser les catégories depuis l\'API, utilisation des valeurs locales. Raison:', e?.message || e);
  }
}

// Démarrage: lancer la sync (non bloquant) + refresh périodique
syncCategoriesFromAPI();
setInterval(syncCategoriesFromAPI, 6 * 60 * 60 * 1000);

function normalizeCategory(rawCategory) {
  const input = String(rawCategory || '').trim();
  const lowerCategory = input.toLowerCase();

  // Gestion spécifique des vidéos → utiliser la catégorie par défaut API
  if (lowerCategory.includes('vidéo') || lowerCategory.includes('video') || lowerCategory.includes('youtube') || lowerCategory.includes('film') || lowerCategory.includes('documentaire')) {
    return DEFAULT_CATEGORY;
  }

  // Mapping spécifique prioritaire (instructions utilisateur)
  const categoryMappings = {
    'pollution': 'Pollution et santé environnementale',
    'énergie': 'Transition énergétique',
    'energy': 'Transition énergétique',
    'eau': 'Eau et assainissement',
    'water': 'Eau et assainissement',
    'climate': 'Changement climatique',
    'climat': 'Changement climatique',
    'biodiversity': 'Biodiversité',
    'biodiversité': 'Biodiversité',
    'sustainable': 'Développement durable',
    'durable': 'Développement durable',
    'agriculture': 'Agriculture et alimentation',
    'agriculture urbaine': 'Agriculture et alimentation',
    'déchets': 'Économie circulaire',
    'waste': 'Économie circulaire',
    'renewable': 'Transition énergétique',
    'renouvelable': 'Transition énergétique'
  };

  let normalizedCategory = null;

  // 1) Si déjà autorisée (exacte), renvoyer telle quelle
  if (ALLOWED_CATEGORIES.has(input)) {
    normalizedCategory = input;
  }

  // 2) Mapping direct exact (prioritaire sur le reste)
  if (!normalizedCategory && categoryMappings[lowerCategory]) {
    normalizedCategory = categoryMappings[lowerCategory];
  }

  // 3) Correspondances partielles avec le mapping
  if (!normalizedCategory) {
    for (const [key, value] of Object.entries(categoryMappings)) {
      if (lowerCategory.includes(key) || key.includes(lowerCategory)) {
        normalizedCategory = value;
        break;
      }
    }
  }

  // 4) Inclusion réciproque contre la liste autorisée
  if (!normalizedCategory) {
    for (const allowedCategory of ALLOWED_CATEGORIES) {
      const a = allowedCategory.toLowerCase();
      if (lowerCategory.includes(a) || a.includes(lowerCategory)) {
        normalizedCategory = allowedCategory;
        break;
      }
    }
  }

  // 5) Fallback final
  if (!normalizedCategory) {
    normalizedCategory = 'Développement durable';
  }

  // Log de débogage
  try { console.log(`Category mapped from '${rawCategory}' to '${normalizedCategory}'`); } catch {}

  return normalizedCategory;
}

function isVideoRelevant(title) {
  const t = (title || '').toLowerCase();
  return VIDEO_KEYWORDS.some(k => t.includes(k.toLowerCase()));
}

async function fetchArticleMeta(url) {
  try {
    const { data } = await getWithRetry(url, { timeout: BASE_TIMEOUT_MS });
    const $ = cheerio.load(data);
    const get = (sel, attr = 'content') => $(sel).attr(attr) || '';
    const content = sanitizeTitle(
      get('meta[property="og:description"]') ||
      get('meta[name="twitter:description"]') ||
      get('meta[name="description"]') ||
      $('p').first().text()
    );
    const imageUrl = normalizeUrl(
      get('meta[property="og:image"]') ||
      get('meta[name="twitter:image"]') ||
      $('img').first().attr('src') || '',
      url
    );
    // Try to extract original published date
    const publishedAt = (
      get('meta[property="article:published_time"]') ||
      get('meta[name="article:published_time"]') ||
      get('meta[name="pubdate"]') ||
      get('meta[name="date"]') ||
      get('meta[property="og:pubdate"]') ||
      ''
    );
    return {
      content: content && content.length >= 20 ? content : '',
      imageUrl: imageUrl || null,
      publishedAt: publishedAt || null,
    };
  } catch {
    return { content: '', imageUrl: null, publishedAt: null };
  }
}

// IMPORTANT: le backend requiert un champ 'content' non vide
function asPayload({ title, url, lang, category = 'Changement climatique', content = '', imageUrl = null, publishedAt = null }) {
  return {
    title,
    content: (content && content.trim()) ? content : String(title || 'Article'),
    lang: lang === 'en' ? 'en' : 'fr',
    category: normalizeCategory(category), // normalise pour correspondre aux catégories autorisées
    imageUrl: imageUrl || null,
    author: null,
    publishedAt: (publishedAt && !Number.isNaN(Date.parse(publishedAt))) ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    sourceUrl: url,
  };
}

async function scrapeLeMonde() {
  const base = 'https://www.lemonde.fr/planete/';
  try {
    const { data } = await getWithRetry(base);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    const NON_ARTICLE_PATH_RX = /(\/video\/|\/portfolio\/|\/blog\/|\/dossier\/|\/tags\/)/i;
    // 1) Sélecteurs spécifiques aux cartes d'article (pass prioritaire)
    $('a.teaser__link, a.article__link, .teaser__title a, a[href*="/planete/"][href*="/article/"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const title = sanitizeTitle($(el).text());
      const href = normalizeUrl($(el).attr('href'), base);
      if (!href || !/lemonde\.fr\/.+\/planete\//.test(href)) { skipped.push({ title, href, reason: 'non-planete' }); return; }
      if (NON_ARTICLE_PATH_RX.test(href)) { skipped.push({ title, href, reason: 'non-article-section' }); return; }
      if (!/\/article\//.test(href)) { skipped.push({ title, href, reason: 'non-article' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (href.includes('#') || /\/live\//.test(href)) { skipped.push({ title, href, reason: 'anchor-or-live' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'fr' });
    });
    // 2) Fallback générique (si pas assez d'items)
    $('section, main').find('article a[href], h3 a[href], h2 a[href]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const title = sanitizeTitle($(el).text());
      const href = normalizeUrl($(el).attr('href'), base);
      if (!href || !/lemonde\.fr\/.+\/planete\//.test(href)) { skipped.push({ title, href, reason: 'non-planete' }); return; }
      if (NON_ARTICLE_PATH_RX.test(href)) { skipped.push({ title, href, reason: 'non-article-section' }); return; }
      if (!/\/article\//.test(href)) { skipped.push({ title, href, reason: 'non-article' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (href.includes('#') || /\/live\//.test(href)) { skipped.push({ title, href, reason: 'anchor-or-live' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'fr' });
    });
    // 3) Ouverture légère: parcourir toutes les ancres filtrées par /planete/ + /article/
    if (results.length < MAX_PER_SOURCE) {
      $('a[href*="/planete/"][href*="/article/"]').each((_, el) => {
        if (results.length >= MAX_PER_SOURCE) return false;
        const title = sanitizeTitle($(el).text());
        const href = normalizeUrl($(el).attr('href'), base);
        if (!href || !/lemonde\.fr\/.+\/planete\//.test(href)) { skipped.push({ title, href, reason: 'non-planete' }); return; }
        if (NON_ARTICLE_PATH_RX.test(href)) { skipped.push({ title, href, reason: 'non-article-section' }); return; }
        if (!/\/article\//.test(href)) { skipped.push({ title, href, reason: 'non-article' }); return; }
        if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
        if (href.includes('#') || /\/live\//.test(href)) { skipped.push({ title, href, reason: 'anchor-or-live' }); return; }
        if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
        results.push({ title, url: href, lang: 'fr' });
      });
    }
    return { results, skipped };
  } catch (e) {
    console.warn('Le Monde: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: base, reason: 'error:' + e.message }] };
  }
}

async function scrapeNatGeo() {
  const base = 'https://www.nationalgeographic.com/environment/';
  try {
    const { data } = await getWithRetry(base);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    // 1) Sélecteurs plus ciblés: liens d'article dans <article> ou liens filtrés par href
    $('main article a[href*="/environment/"][href*="/article/"], a[href*="/environment/"][href*="/article/"], a[href*="/environment/"][href*="/science/"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      const title = sanitizeTitle($(el).text());
      if (!href || !/nationalgeographic\.com\/environment\//.test(href)) { skipped.push({ title, href, reason: 'non-environment or invalid href' }); return; }
      if (!/\/article\//.test(href)) { skipped.push({ title, href, reason: 'non-article' }); return; }
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    // 2) Fallback générique (si pas assez d'items)
    $('main a[href], section a[href]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      if (!href || !/nationalgeographic\.com\/environment\//.test(href)) { skipped.push({ title: '', href, reason: 'non-environment or invalid href' }); return; }
      if (!/\/article\//.test(href)) { skipped.push({ title: '', href, reason: 'non-article' }); return; }
      const title = sanitizeTitle($(el).text());
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    // 3) Ouverture légère: toutes ancres avec filtres /environment/ + /article/
    if (results.length < MAX_PER_SOURCE) {
      $('a[href*="/environment/"][href*="/article/"], a[href*="/environment/"][href*="/science/"]').each((_, el) => {
        if (results.length >= MAX_PER_SOURCE) return false;
        const href = normalizeUrl($(el).attr('href'), base);
        const title = sanitizeTitle($(el).text());
        if (!href || !/nationalgeographic\.com\/environment\//.test(href)) { skipped.push({ title, href, reason: 'non-environment or invalid href' }); return; }
        if (!/\/article\//.test(href)) { skipped.push({ title, href, reason: 'non-article' }); return; }
        if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
        if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
        results.push({ title, url: href, lang: 'en' });
      });
    }
    return { results, skipped };
  } catch (e) {
    console.warn('NatGeo: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: base, reason: 'error:' + e.message }] };
  }
}

async function scrapeBBC() {
  const base = 'https://www.bbc.com/news/science_and_environment';
  try {
    const { data } = await getWithRetry(base);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    // 1) Sélecteurs spécifiques: headings de promos BBC (inclure variations récentes)
    $('a.gs-c-promo-heading, a:has(h3.gs-c-promo-heading__title), a[href*="/news/"][href*="science"], a[href*="/news/"][href*="environment"]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      if (!href || !/bbc\.com\/news\//.test(href)) { skipped.push({ title: '', href, reason: 'non-news or invalid href' }); return; }
      if (!(/science/.test(href) || /environment/.test(href))) { skipped.push({ title: '', href, reason: 'non-science/environment' }); return; }
      if (/\/av\//.test(href) || /\/live\//.test(href)) { skipped.push({ title: '', href, reason: 'av-or-live' }); return; }
      if (!/article|\/[a-z0-9-]{6,}/i.test(href)) { skipped.push({ title: '', href, reason: 'likely-index' }); return; }
      const title = sanitizeTitle($(el).text());
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    $('main a[href]').each((_, el) => {
      if (results.length >= MAX_PER_SOURCE) return false;
      const href = normalizeUrl($(el).attr('href'), base);
      if (!href || !/bbc\.com\/news\//.test(href)) { skipped.push({ title: '', href, reason: 'non-news or invalid href' }); return; }
      if (!(/science/.test(href) || /environment/.test(href))) { skipped.push({ title: '', href, reason: 'non-science/environment' }); return; }
      if (/\/av\//.test(href) || /\/live\//.test(href)) { skipped.push({ title: '', href, reason: 'av-or-live' }); return; }
      // Exclure pages index/section sans slug article (heuristique: nécessite au moins un tiret ou 'article')
      if (!/article|\/[a-z0-9-]{6,}/i.test(href)) { skipped.push({ title: '', href, reason: 'likely-index' }); return; }
      const title = sanitizeTitle($(el).text());
      if (isBadTitle(title)) { skipped.push({ title, href, reason: 'bad-title' }); return; }
      if (seen.has(href)) { skipped.push({ title, href, reason: 'dup-in-page' }); return; } seen.add(href);
      results.push({ title, url: href, lang: 'en' });
    });
    // 3) Ouverture légère: toutes ancres news science/environment avec heuristique d'article
    if (results.length < MAX_PER_SOURCE) {
      $('a[href*="/news/"]').each((_, el) => {
        if (results.length >= MAX_PER_SOURCE) return false;
        const href = normalizeUrl($(el).attr('href'), base);
        if (!href || !/bbc\.com\/news\//.test(href)) { return; }
        if (!(/science/.test(href) || /environment/.test(href))) { return; }
        if (/\/av\//.test(href) || /\/live\//.test(href)) { return; }
        if (!/article|\/[a-z0-9-]{6,}/i.test(href)) { return; }
        const title = sanitizeTitle($(el).text());
        if (isBadTitle(title)) { return; }
        if (seen.has(href)) { return; } seen.add(href);
        results.push({ title, url: href, lang: 'en' });
      });
    }
    return { results, skipped };
  } catch (e) {
    console.warn('BBC: erreur scrape:', e.message);
    return { results: [], skipped: [{ title: '', href: base, reason: 'error:' + e.message }] };
  }
}

async function sendArticle(payload) {
  try {
    // Validation locale (levée d'exception si invalide)
    validatePayload(payload);
    // Appel POST (timeout augmenté)
    const res = await axiosPost.post(API_URL, payload);
    if (res.status >= 200 && res.status < 300 && res.data?.success !== false) {
      console.log('✅ Article posté:', payload.title);
      return true;
    }
    console.error('POST /api/news KO', res.status, res.data);
    return false;
  } catch (e) {
    // Cas idempotent: doublon déjà présent
    if (e?.response?.status === 409) {
      console.warn('ℹ️ Doublon détecté (409), traité comme succès pour', String(payload?.title || '').slice(0,80));
      return true;
    }
    if (e?.response?.status === 429) {
      console.warn('⚠️ Rate limited (429) pour', String(payload?.title || '').slice(0,80));
    }
    if (e?.code === 'ECONNABORTED' || e?.response?.status === 408) {
      console.warn('⚠️ Timeout de publication pour', String(payload?.title || '').slice(0,80));
    }
    logErrorWithContext(e, {
      articleTitle: String(payload?.title || '').slice(0, 80),
      source: getDomainFromUrl(payload?.sourceUrl || ''),
      url: payload?.sourceUrl || null,
      category: payload?.category || null,
      lang: payload?.lang || null,
      api: API_URL,
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// (placeholders supprimés — vraies implémentations ci-dessus)

async function connectivityDiagnostics() {
  try {
    console.log('🌐 Diagnostic de connectivité: démarrage');
    const domains = [
      'www.google.com',
      'www.lemonde.fr',
      'www.nationalgeographic.com',
      'www.bbc.com',
      'www.ipcc.ch',
      'www.unep.org',
    ];
    for (const d of domains) {
      try {
        const r = await dns.resolve(d);
        console.log(`  ✅ DNS ${d} -> ${Array.isArray(r) ? r.slice(0,2).join(',') : String(r)}`);
      } catch (e) {
        console.warn(`  ❗ DNS échec pour ${d}:`, e?.message || e);
      }
    }
    // Requête HTTP légère (204) pour vérifier sortie internet
    try {
      const url204 = 'https://www.google.com/generate_204';
      await http.get(url204, { timeout: 8000 });
      console.log('  ✅ Accès internet (generate_204) OK');
    } catch (e) {
      console.warn('  ❗ Accès internet (generate_204) KO:', e?.message || e);
    }
  } catch (e) {
    console.warn('Diagnostic connectivité: erreur inattendue:', e?.message || e);
  }
}

async function runOnce() {
  const t0 = Date.now();
  console.log('🔎 Scraper: démarrage');
  await connectivityDiagnostics();
  const batches = await Promise.all([
    scrapeLeMonde(),
    scrapeNatGeo(),
    scrapeBBC(),
    scrapeVideos(),
    scrapeIPCC(),
    scrapeUNEP(),
    scrapeScienceDaily(),
    scrapePhysOrg(),
    scrapeYouTubeAPI(),
  ]);
  const preItems = batches.flatMap(b => b.results);
  const skippedAll = batches.flatMap(b => b.skipped);
  console.log(`RAW_COUNT: ${preItems.length}`);
  console.log(`📥 Collecte brute: ${preItems.length} item(s)`);
  if (preItems.length) {
    console.log('📄 Titres (brut):');
    preItems.forEach((it, i) => console.log(`  - [${i+1}] ${it.title} :: ${it.url}`));
  }
  if (skippedAll.length) {
    console.log(`SKIPPED_COUNT: ${skippedAll.length}`);
    console.log(`🚫 Skipped: ${skippedAll.length}`);
    skippedAll.forEach((s, i) => console.log(`  x [${i+1}] reason=${s.reason} :: ${s.title || '(no-title)'} :: ${s.href || '(no-url)'}`));
  }

  // Déduplication inter-sources par clé (titre normalisé + domaine) pour capter mêmes sujets multi-URLs
  const seenKeys = new Set();
  const items = [];
  for (const it of preItems) {
    if (!it?.url) continue;
    const domain = getDomainFromUrl(it.url);
    const normTitle = normalizeForDedupTitle(it.title || '');
    const key = `${domain}::${normTitle}`;
    if (!normTitle || seenKeys.has(key)) continue;
    seenKeys.add(key);
    items.push(it);
  }
  console.log(`DEDUP_COUNT: ${items.length}`);
  console.log(`📦 Après déduplication inter-sources: ${items.length} item(s)`);

  // Enrichir seulement les ENRICH_CAP premiers
  const toEnrich = items.slice(0, ENRICH_CAP);
  const rest = items.slice(ENRICH_CAP);
  const enrichTimes = [];

  const enrichedPayloads = await mapWithConcurrency(
    toEnrich,
    MAX_ENRICH_CONCURRENCY,
    async (it) => {
      const s = Date.now();
      const meta = await fetchArticleMeta(it.url);
      const dt = Date.now() - s;
      enrichTimes.push(dt);
      return asPayload({
        title: it.title,
        url: it.url,
        lang: it.lang,
        category: mapCategory(it.title),
        content: meta.content,
        imageUrl: meta.imageUrl,
        publishedAt: meta.publishedAt,
      });
    }
  );

  const basicPayloads = rest.map(it =>
    asPayload({
      title: it.title,
      url: it.url,
      lang: it.lang,
      category: mapCategory(it.title),
    })
  );

  // Envoi (concurrence limitée)
  const allPayloads = [...enrichedPayloads, ...basicPayloads];
  let ok = 0;
  let ko = 0;
  await mapWithConcurrency(
    allPayloads,
    MAX_POST_CONCURRENCY,
    async (p) => {
      // Réessai avec backoff pour améliorer le taux de succès et capturer des erreurs transitoires
      const sent = await retryWithBackoff(() => sendArticle(p), 3, Number(process.env.POST_RETRY_BASE_DELAY_MS || 1000)).catch((err) => {
        // L'opération a jeté après les tentatives: déjà loggée par sendArticle/logErrorWithContext
        return false;
      });
      if (POST_THROTTLE_MS > 0) { await delay(POST_THROTTLE_MS); }
      if (sent) ok++; else ko++;
      return sent;
    }
  );

  const totalMs = Date.now() - t0;
  const avgMs = enrichTimes.length ? Math.round(enrichTimes.reduce((a, b) => a + b, 0) / enrichTimes.length) : 0;
  const p95Ms = Math.round(percentile(enrichTimes, 95));
  console.log(`⏱️ Enrichissement: ${enrichedPayloads.length}/${items.length} (cap=${ENRICH_CAP}), avg=${avgMs}ms, p95=${p95Ms}ms, total=${totalMs}ms`);
  console.log(`📤 Scraper: ${ok}/${allPayloads.length} article(s) posté(s)`);
  console.log(`POST_SUMMARY: ok=${ok} ko=${ko} total=${allPayloads.length}`);
  console.log(`ENRICH_CAP_USED: ${ENRICH_CAP}`);
}

// Exécution avec gestion d'erreurs globale
try {
  runOnce()
    .then(() => console.log('🏁 Scraper terminé.'))
    .catch((e) => {
      console.error('❌ Scraper: échec global:', e?.stack || e);
      process.exitCode = 1;
    });
} catch (e) {
  console.error('❌ Scraper: exception non interceptée au niveau supérieur:', e?.stack || e);
  process.exitCode = 1;
}
