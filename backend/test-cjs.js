console.log('Test en mode CommonJS...');

const express = require('express');
const path = require('path');

console.log('Démarrage du serveur Express en mode CommonJS...');
console.log('Dossier courant:', process.cwd());

const app = express();
const PORT = 5002;

// Middleware de base
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route de base
app.get('/', (req, res) => {
  res.send(`
    <h1>Serveur Express en mode CommonJS</h1>
    <p>Le serveur fonctionne correctement !</p>
    <p>Mode: ${process.env.NODE_ENV || 'development'}</p>
    <p>Node.js: ${process.version}</p>
    <p><a href="/api/health">Vérifier l'état de l'API</a></p>
  `);
});

// Route d'API de test
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Test Express (CommonJS)',
    nodeVersion: process.version,
    port: PORT,
    environment: process.env.NODE_ENV || 'development'
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
  console.error('Erreur non capturée:', err);
  process.exit(1);
});
