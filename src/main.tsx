// First, before any other import: the design-system theme has to be active
// before a single `@sudobility/components` module is evaluated (see the
// module's doc comment). Imports are hoisted, so only import order counts.
import '@/config/theme';
// Configure the Firebase China proxy before anything initializes Firebase.
// Blank/unset means standard Firebase (the library holds no default).
import { setFirebaseProxy } from '@sudobility/di';
setFirebaseProxy(import.meta.env.VITE_FIREBASE_PROXY);

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
