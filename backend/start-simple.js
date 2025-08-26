console.log('Démarrage du serveur simplifié...');

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
  
  // Création d'un serveur Express minimal
  import express from 'express';
  const app = express();
  
  // Middleware de base
  app.use(express.json());
  
  // Route de test
  app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Serveur EcoScope en cours d\'exécution', timestamp: new Date().toISOString() });
  });
  
  // Route de test API
  app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'EcoScope Backend', timestamp: new Date().toISOString() });
  });
  
  // Démarrer le serveur
  const PORT = process.env.PORT || 5002;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`   - API Health: http://localhost:${PORT}/api/health`);
  });
  
} catch (error) {
  console.error('\n❌ Erreur lors du démarrage du serveur:', error.message);
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
