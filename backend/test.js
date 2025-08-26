console.log('Test de Node.js...');
console.log('Version de Node.js:', process.version);
console.log('Dossier courant:', process.cwd());
console.log('Variables d\'environnement:');
console.log('- PORT:', process.env.PORT);
console.log('- NODE_ENV:', process.env.NODE_ENV);

// Test d'import de module
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log('Chemin du fichier:', __filename);
console.log('Dossier parent:', path.join(__dirname, '..'));

// Test de création de fichier
try {
  const fs = await import('fs');
  const testFilePath = path.join(__dirname, 'test-file.txt');
  fs.writeFileSync(testFilePath, 'Ceci est un test');
  console.log('Fichier créé avec succès:', testFilePath);
  
  // Suppression du fichier de test
  fs.unlinkSync(testFilePath);
  console.log('Fichier de test supprimé');
} catch (error) {
  console.error('Erreur lors du test de fichiers:', error.message);
}

console.log('Test terminé avec succès!');
