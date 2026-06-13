import React from 'react';
import { createRoot } from 'react-dom/client';
import WebApp from './WebApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<WebApp />);
}
