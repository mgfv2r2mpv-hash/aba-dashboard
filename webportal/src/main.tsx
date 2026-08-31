import './portal.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import WebApp from './WebApp';
import AuthGate from './auth/AuthGate';

const container = document.getElementById('root');
// AuthGate decides whether the portal shows a sign-in screen or the app. On a
// deployment with no login store bound it hands straight through, which is every
// build before Phase 2 and the reason this cannot take the site down.
if (container) {
  createRoot(container).render(
    <AuthGate>
      <WebApp />
    </AuthGate>,
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failing is non-fatal
    });
  });
}
