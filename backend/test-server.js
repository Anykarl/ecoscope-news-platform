console.log('Démarrage du test...');

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

// Vérification de l'existence du fichier .env
try {
  const fileExists = fs.existsSync(envPath);
  console.log('Le fichier .env existe:', fileExists);
  if (fileExists) {
    console.log('Contenu du fichier .env:');
    console.log('------------------------');
    console.log(fs.readFileSync(envPath, 'utf-8'));
    console.log('------------------------');
  } else {
    console.log('Création du fichier .env...');
    fs.writeFileSync(envPath, 'PORT=5002\nNODE_ENV=development\nVITE_API_URL=http://localhost:5002');
    console.log('Fichier .env créé avec succès');
  }
} catch (error) {
  console.error('Erreur lors de la lecture/écriture du fichier .env:', error.message);
  process.exit(1);
}

// Chargement des variables d'environnement
try {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Erreur dotenv:', result.error);
    throw result.error;
  }
  
  console.log('\n✅ Fichier .env chargé avec succès');
  console.log('🔧 Configuration chargée:');
  console.log('   - PORT:', process.env.PORT);
  console.log('   - NODE_ENV:', process.env.NODE_ENV);
  console.log('   - VITE_API_URL:', process.env.VITE_API_URL);
  
  // Vérification des variables requises
  const requiredVars = ['PORT', 'NODE_ENV'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Variables manquantes: ${missingVars.join(', ')}`);
  }
  
  console.log('\n✅ Toutes les variables requises sont présentes');
  console.log('\nTest terminé avec succès!');
  
} catch (error) {
  console.error('\n❌ Erreur lors du chargement de la configuration:', error.message);
  process.exit(1);
}
