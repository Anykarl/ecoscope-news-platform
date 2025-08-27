import express from 'express';
import cors from 'cors';

console.log('🚀 Démarrage du serveur minimal...');

const app = express();
const PORT = 5002;

// CORS simple
app.use(cors({
  origin: ['http://localhost:3000', 'https://ecoscope-news-platform.vercel.app'],
  credentials: true
}));

app.use(express.json());

// Routes de test
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Serveur minimal EcoScope', 
    timestamp: new Date().toISOString() 
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'EcoScope Test Backend (Minimal)', 
    timestamp: new Date().toISOString() 
  });
});

app.get('/api/news', (req, res) => {
  res.json({ 
    news: [
      { id: 1, title: 'Test News 1', content: 'Contenu test 1' },
      { id: 2, title: 'Test News 2', content: 'Contenu test 2' }
    ]
  });
});

app.get('/api/features', (req, res) => {
  res.json({ 
    features: [
      { id: 1, name: 'Feature 1', description: 'Description test 1' },
      { id: 2, name: 'Feature 2', description: 'Description test 2' }
    ]
  });
});

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur minimal démarré sur http://localhost:${PORT}`);
  console.log(`🌐 Endpoints disponibles:`);
  console.log(`   - GET /`);
  console.log(`   - GET /health`);
  console.log(`   - GET /api/news`);
  console.log(`   - GET /api/features`);
}).on('error', (err) => {
  console.error('❌ Erreur de démarrage:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${PORT} déjà utilisé. Essayez de tuer le processus:`);
    console.log(`   netstat -ano | findstr :${PORT}`);
    console.log(`   taskkill /PID <PID> /F`);
  }
  process.exit(1);
});
