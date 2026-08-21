/**
 * Centralized app constants derived from environment variables (sudojo_app
 * pattern). All `VITE_*` variables are read at build time with sensible
 * local-dev defaults; production values come from the deployment
 * environment. Never hardcode the product name / company / domain in
 * components — read them from here.
 */
import packageJson from '../../package.json';

/** Application-wide configuration constants. */
export const CONSTANTS = {
  // Branding
  APP_NAME: import.meta.env.VITE_APP_NAME || 'Moosiac',
  APP_DOMAIN: import.meta.env.VITE_APP_DOMAIN || 'scoresmith.app',
  COMPANY_NAME: import.meta.env.VITE_COMPANY_NAME || 'Sudobility',
  APP_VERSION: packageJson.version,
  SUPPORT_EMAIL: import.meta.env.VITE_SUPPORT_EMAIL || 'support@sudobility.com',

  // API
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:8032',
} as const;
