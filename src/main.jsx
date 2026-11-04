import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// After a new Vercel deploy, lazy-loaded chunk hashes change. If a visitor has
// the old SPA in their browser tab and clicks a link, React tries to import a
// chunk URL that no longer exists → 404. One reload fetches the new index.html
// and the correct chunk hashes.
// Key the flag on the failing chunk URL (includes its content hash) so each
// unique chunk gets one reload attempt — a new deploy produces new hashes and
// therefore new keys, allowing reloads to fire again on the next deploy.
window.addEventListener('vite:preloadError', (event) => {
  const chunkUrl = event?.payload?.id || '';
  const key = `vpr_${chunkUrl.slice(-32)}`;
  const attempt = parseInt(sessionStorage.getItem(key) || '0', 10);
  if (attempt >= 2) return; // stop after 2 attempts per chunk
  sessionStorage.setItem(key, String(attempt + 1));
  if (attempt === 0) {
    window.location.reload();
  } else {
    // Second attempt: navigate with a cache-buster so Vercel serves fresh HTML
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now());
    window.location.replace(url.toString());
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)