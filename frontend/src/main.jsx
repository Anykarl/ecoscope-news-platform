import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './pages/HomePage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import './index.css';
import { initTheme, getStoredTheme, setTheme, toggleTheme, getEffectiveTheme } from './utils/theme.js';

function App() {
  const [page, setPage] = React.useState('home');
  const [theme, setThemeState] = React.useState('system');

  React.useEffect(() => {
    const dispose = initTheme();
    setThemeState(getStoredTheme());
    return dispose;
  }, []);

  const onThemeToggle = () => {
    const next = toggleTheme();
    // reflect persisted pref: if user toggles explicitly, store as 'light' or 'dark'
    setThemeState(next);
  };
  const effective = getEffectiveTheme(theme);
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <nav className="flex gap-2 p-3 border-b border-gray-200 bg-white sticky top-0 z-10 dark:bg-gray-800 dark:border-gray-700">
        <button onClick={() => setPage('home')} className={`px-3 py-2 rounded-md text-sm font-medium ${page==='home'?'bg-emerald-600 text-white':'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'}`}>
          Accueil
        </button>
        <button onClick={() => setPage('admin')} className={`px-3 py-2 rounded-md text-sm font-medium ${page==='admin'?'bg-emerald-600 text-white':'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'}`}>
          Administration
        </button>
        <button
          onClick={onThemeToggle}
          aria-label={effective === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre'}
          className={`ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border transition
            border-gray-200 bg-white hover:bg-gray-100 text-gray-700
            dark:border-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100`}
        >
          {/* Icon container with simple rotate/scale animation */}
          <span className="relative w-5 h-5 inline-block">
            {/* Sun */}
            <svg
              className={`absolute inset-0 transition-transform duration-300 ${effective === 'dark' ? 'scale-0 rotate-90' : 'scale-100 rotate-0'}`}
              xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
            >
              <path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10-9h-2v3h2V4zm7.04.46l-1.41-1.41-1.8 1.79 1.41 1.41 1.8-1.79zM17 11a5 5 0 11-10 0 5 5 0 0110 0zm3 2h3v-2h-3v2zM4 17.24l-1.79 1.8 1.41 1.41 1.8-1.79L4 17.24zM11 20h2v-3h-2v3zm7.66-1.55l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4z"/>
            </svg>
            {/* Moon */}
            <svg
              className={`absolute inset-0 transition-transform duration-300 ${effective === 'dark' ? 'scale-100 rotate-0' : 'scale-0 -rotate-90'}`}
              xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
            >
              <path d="M20.742 13.045A8 8 0 1111 3a7 7 0 009.742 10.045z"/>
            </svg>
          </span>
          <span className="hidden sm:inline">{effective === 'dark' ? 'Sombre' : 'Clair'}</span>
        </button>
      </nav>
      {page === 'home' ? <HomePage /> : <AdminPage />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
