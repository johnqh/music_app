/**
 * Application boundary for ScoreSmith.
 *
 * `music_lib` is the business package. The editor engine and the application
 * store are composed here because the browser is the host that needs both.
 * Keeping this facade local also prevents UI/editor APIs from leaking back
 * into the business package.
 */
export * from '@sudobility/music_lib';
export * from '@sudobility/music_editing';
export * from '@sudobility/music_codecs';
export * from '@sudobility/music_drawing';
export * from '@sudobility/music_io';
export * from '@sudobility/music_player';

export * from './store/context.js';
export * from './store/document-store.js';
export * from './store/useAppStore.js';
export * from './services/errors.js';
export * from './services/export/export-plan.js';
export * from './services/library-copy.js';
export * from './services/persistence/document-saver.js';
export * from './services/persistence/project-ui.js';
export * from './services/persistence/project-write.js';
export * from './services/playback/adapter.js';
export * from './services/playback/bind-player.js';
export * from './services/perf/benchmark.js';
export * from './test/store-context.js';
export { PlaybackBus } from '@sudobility/music_player/core';
