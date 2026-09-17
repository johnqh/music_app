/**
 * The words the libraries need, in this app's language.
 *
 * The tables themselves — which key each undo label, refusal, MusicXML warning,
 * selection readout, library message and template name reads — are music_lib's
 * (`createLibraryCopy`), because the React Native app needs the same five and
 * two hand-written copies had already drifted. What stays here is the one thing
 * a library cannot supply: the translate function.
 *
 * Every entry resolves its words when it is read, not when this object is
 * built, so a reader who switches language mid-session is told the next thing
 * in the new one.
 *
 * The bare `i18next` singleton, deliberately, not the app's `@/i18n` module:
 * that one calls `.use(Backend).init(...)` on import, so pulling it in here
 * would start an HTTP fetch of the translation bundles in every test that
 * transitively touches editing — which it did once, and four suites timed out.
 * The app initialises this same instance at start-up, so at runtime the
 * strings are there; under test `t` returns the key, which is deterministic.
 */
import i18next from 'i18next';
import { createLibraryCopy } from '@/app-library';

export const libraryCopy = createLibraryCopy((key, options) => i18next.t(key, options));
