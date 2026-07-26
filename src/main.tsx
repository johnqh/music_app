import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { initializeApp } from '@/config/initialize';
import { CONSTANTS } from '@/config/constants';
import '@/i18n';
import '@/index.css';

initializeApp();
document.title = CONSTANTS.APP_NAME;

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element with id "root" was not found in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
