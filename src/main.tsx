import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { initializeApp } from '@/config/initialize';

initializeApp();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element with id "root" was not found in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
