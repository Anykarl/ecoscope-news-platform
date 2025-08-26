import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Démarrage du serveur Express de test...');
console.log('Dossier courant:', process.cwd());

const app = express();
const PORT = 5002;

// Middleware de base
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route de base
app.get('/', (req, res) => {
  res.send(`
    <h1>Serveur Express de test</h1>
    <p>Le serveur fonctionne correctement !</p>
    <p><a href="/api/health">Vérifier l'état de l'API</a></p>
  `);
});

// Route d'API de test
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Test Express',
    nodeVersion: process.version
  });
});

// Démarrer le serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   - Page d'accueil: http://localhost:${PORT}`);
  console.log(`   - API Health: http://localhost:${PORT}/api/health`);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  console.error('Erreur non capturée:', err);  process.exit(1);
});
