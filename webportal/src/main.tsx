import './portal.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import WebApp from './WebApp';

const container = document.getElementById('root');
if (container) createRoot(container).render(<WebApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failing is non-fatal
    });
  });
}
