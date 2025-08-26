# Guide de déploiement EcoScope

## Architecture de déploiement
- **Frontend** : Netlify (CDN global)
- **Backend** : Railway (Node.js + PostgreSQL)

## Étapes de déploiement

### 1. Repository GitHub
Créer un repository public/privé : `ecoscope-news-platform`

### 2. Backend sur Railway

1. **Créer un compte sur Railway.app**
2. **Connecter GitHub** et sélectionner le repository
3. **Variables d'environnement à configurer :**
   ```
   NODE_ENV=production
   PORT=5002
   ENABLE_CRON=true
   SCRAPE_INTERVAL_MINUTES=30
   ```
4. **Le déploiement se fait automatiquement** avec `railway.json`

### 3. Frontend sur Netlify

1. **Créer un compte sur Netlify.com**
2. **Connecter GitHub** et sélectionner le repository
3. **Configuration automatique** via `netlify.toml`
4. **Variables d'environnement :**
   ```
   VITE_API_URL=https://votre-backend.up.railway.app
   ```

### 4. Configuration finale

1. **Récupérer l'URL Railway** du backend déployé
2. **Mettre à jour `netlify.toml`** avec la vraie URL
3. **Redéployer Netlify** pour prendre en compte l'URL

## URLs finales
- **Frontend** : `https://votre-site.netlify.app`
- **Backend** : `https://votre-backend.up.railway.app`
- **Admin** : `https://votre-site.netlify.app/admin`

## Monitoring
- Railway : Logs et métriques automatiques
- Netlify : Analytics et déploiements
