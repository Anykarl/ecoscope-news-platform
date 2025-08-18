// Scraper minimal viable pour EcoScope (ESM)
// - Sources: Le Monde (Planète, FR), National Geographic (Environment, EN), BBC (Science & Environment, EN)
// - Extraction: liens récents (<=5 par source), titre + URL (extrait court optionnel)
// - Injection: POST vers API locale /api/news
// Remarques: code simple et commenté pour validation pipeline cron → scraper → API → SSE

import axios from 'axios';
import * as cheerio from 'cheerio';

// Forcer IPv4 pour éviter ::1
const API_URL = process.env.ECOSCOPE_API_URL || 'http://127.0.0.1:5001/api/news';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 EcoScopeScraper/1.1';
const REQ_OPTS = { timeout: 12000, headers: { 'User-Agent': UA, 'Accept-Language': 'fr,en;q=0.8' } };
// Plafond global d'articles enrichis (meta + image) par session
// Configurable via ENRICH_CAP ou MAX_ENRICH (défaut 30)
const ENRICH_CAP = Number(process.env.ENRICH_CAP || process.env.MAX_ENRICH || 30);
const MAX_PER_SOURCE = Number(process.env.MAX_PER_SOURCE || 30); // plafond par source

// Concurrence contrôlée et délais polis entre lots
const MAX_ENRICH_CONCURRENCY = 4;
const MAX_POST_CONCURRENCY = 4;
const BATCH_DELAY_MS = 750;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (has('climate', 'climat', 'heatwave', 'canicule', 'réchauff', 'warming', 'greenhouse')) return 'Changement climatique';
  if (has('pollution', 'plastique', 'microplastic', 'air quality', 'air', 'smog', 'eau', 'water', 'waste')) return 'Pollution';
  if (has('biodivers', 'wildlife', 'espèce', 'faune', 'flore', 'habitat', 'ecosystem')) return 'Biodiversité';
  if (has('énergie', 'energie', 'energy', 'solar', 'wind', 'nuclear', 'nucléaire', 'oil', 'gaz', 'gas', 'renewable', 'hydrogen')) return 'Énergie';
  if (has('eau', 'water', 'sécheresse', 'drought', 'inond', 'flood', 'rivière', 'river', 'aquifer', 'nappe', 'groundwater', 'wetland', 'marais', 'barrage', 'dam', 'desalination', 'salinisation')) return 'Eau';
  if (has('agriculture', 'agricole', 'farmer', 'crop', 'récolte', 'pesticide', 'fertilizer', 'fertilisant', 'soil', 'sol', 'irrigation', 'livestock', 'élevage')) return 'Agriculture';
  if (has('incendie', 'wildfire', 'séisme', 'earthquake', 'tsunami', 'volcano', 'volcan', 'ouragan', 'hurricane', 'cyclone', 'typhoon', 'tempête', 'storm', 'landslide', 'glissement', 'avalanche')) return 'Risques naturels';
  return 'Changement climatique';
}

async function fetchArticleMeta(url) {
  try {
    const { data } = await axios.get(url, { ...REQ_OPTS, timeout: 9000 });
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
    return {
      content: content && content.length >= 20 ? content : '',
      imageUrl: imageUrl || null,
    };
  } catch {
    return { content: '', imageUrl: null };
  }
}

// IMPORTANT: le backend requiert un champ 'content' non vide
function asPayload({ title, url, lang, category = 'Changement climatique', content = '', imageUrl = null }) {
  return {
    title,
    content: (content && content.trim()) ? content : String(title || 'Article'),
    lang: lang === 'en' ? 'en' : 'fr',
    category, // doit exister côté backend (ex: "Changement climatique")
    imageUrl: imageUrl || null,
    author: null,
    publishedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}

async function scrapeLeMonde() {
  const base = 'https://www.lemonde.fr/planete/';
  try {
    const { data } = await axios.get(base, REQ_OPTS);
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
    const { data } = await axios.get(base, REQ_OPTS);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    // 1) Sélecteurs plus ciblés: liens d'article dans <article> ou liens filtrés par href
    $('main article a[href*="/environment/"][href*="/article/"], a[href*="/environment/"][href*="/article/"]').each((_, el) => {
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
    $('main a[href]').each((_, el) => {
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
      $('a[href*="/environment/"][href*="/article/"]').each((_, el) => {
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
    const { data } = await axios.get(base, REQ_OPTS);
    const $ = cheerio.load(data);
    const seen = new Set();
    const results = [];
    const skipped = [];
    // 1) Sélecteurs spécifiques: headings de promos BBC
    $('a.gs-c-promo-heading, a[href*="/news/"][href*="science"], a[href*="/news/"][href*="environment"]').each((_, el) => {
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
    const res = await axios.post(API_URL, payload, { headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, timeout: 12000 });
    if (res.status >= 200 && res.status < 300 && res.data?.success !== false) {
      console.log('✅ Article posté:', payload.title);
      return true;
    }
    console.error('POST /api/news KO', res.status, res.data);
    return false;
  } catch (e) {
    console.error('Erreur POST /api/news:', e.message);
    return false;
  }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function runOnce() {
  const t0 = Date.now();
  console.log('🔎 Scraper: démarrage');
  const batches = await Promise.all([
    scrapeLeMonde(),
    scrapeNatGeo(),
    scrapeBBC(),
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

  // Déduplication inter-sources par URL (post-collecte)
  const seenUrls = new Set();
  const items = [];
  for (const it of preItems) {
    if (!it?.url || seenUrls.has(it.url)) continue;
    seenUrls.add(it.url);
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
  await mapWithConcurrency(
    allPayloads,
    MAX_POST_CONCURRENCY,
    async (p) => {
      const sent = await sendArticle(p);
      if (sent) ok++;
      return sent;
    }
  );

  const totalMs = Date.now() - t0;
  const avgMs = enrichTimes.length ? Math.round(enrichTimes.reduce((a, b) => a + b, 0) / enrichTimes.length) : 0;
  const p95Ms = Math.round(percentile(enrichTimes, 95));
  console.log(`⏱️ Enrichissement: ${enrichedPayloads.length}/${items.length} (cap=${ENRICH_CAP}), avg=${avgMs}ms, p95=${p95Ms}ms, total=${totalMs}ms`);
  console.log(`📤 Scraper: ${ok}/${allPayloads.length} article(s) posté(s)`);
}

// Exécution
runOnce().then(() => console.log('🏁 Scraper terminé.'));
