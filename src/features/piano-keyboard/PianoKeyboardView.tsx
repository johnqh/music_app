/**
 * A picture of a piano keyboard whose keys light up as the active track
 * plays, so a musician can watch which keys to press and learn the piece.
 *
 * Read-only by design: clicking a key does nothing. The notation view is the
 * editor; this is a practice aid, and making keys playable would put a second
 * note-entry surface in the app for no stated need.
 *
 * Rendered as absolutely-positioned divs rather than canvas. 88 elements lay
 * out trivially, each gets a testid for free, and the canvas renderer exists
 * for notation because VexFlow requires it — not as a house style.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from '@sudobility/components';
import { findTrack, selectActiveTrackId, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { resolveColorScheme } from '@/app/theme';
import {
  MIN_WHITE_KEY_WIDTH,
  WHITE_KEY_COUNT,
  computeKeys,
  keyboardWidth,
} from '@/features/piano-keyboard/keyboard-geometry';
import { playingPitchesForTrack } from '@/features/piano-keyboard/playing-pitches';

export type PianoKeyboardViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** When true, only the header strip renders. Owned by `AppLayout`, which also persists it. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

/** Height of the header strip holding the track name and the collapse control. */
const HEADER_HEIGHT = 28;
/** Room below the keys for the C labels. */
const LABEL_GUTTER = 14;
/** Used when the panel isn't measurable (jsdom reports 0), so tests get real geometry. */
const FALLBACK_WIDTH = 1000;
const FALLBACK_KEY_HEIGHT = 96;

export function PianoKeyboardView({
  store = useAppStore,
  collapsed = false,
  onToggleCollapsed = () => undefined,
}: PianoKeyboardViewProps) {
  const score = store((s) => s.score);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const playbackState = store((s) => s.state);
  const activeTrackId = store(selectActiveTrackId);
  const themeMode = store((s) => s.themeMode);

  const theme = useMemo(
    () => (resolveColorScheme(themeMode) === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME),
    [themeMode],
  );

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_KEY_HEIGHT });

  // Same measure-then-observe pattern the notation view uses for `viewWidth`.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = (): void => {
      setBox({
        width: el.clientWidth || FALLBACK_WIDTH,
        height: Math.max(1, (el.clientHeight || FALLBACK_KEY_HEIGHT) - LABEL_GUTTER),
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsed]);

  const whiteKeyWidth = Math.max(MIN_WHITE_KEY_WIDTH, box.width / WHITE_KEY_COUNT);
  const keys = useMemo(
    () => computeKeys(whiteKeyWidth, box.height),
    [whiteKeyWidth, box.height],
  );

  /**
   * Gated on `playbackState`, not just on `activeNoteIds` being non-empty:
   * the Tone engine clears active notes on `stop()` but NOT on `pause()`, so
   * without the gate a pause would leave whatever was mid-chord stuck lit.
   */
  const lit = useMemo(() => {
    if (playbackState !== 'playing' || !score) return new Set<number>();
    return playingPitchesForTrack(score, activeNoteIds, activeTrackId);
  }, [playbackState, score, activeNoteIds, activeTrackId]);

  const trackName = activeTrackId && score ? (findTrack(score, activeTrackId)?.name ?? null) : null;

  const header = (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-theme-border px-2"
      style={{ height: HEADER_HEIGHT }}
    >
      <span className="text-xs font-medium text-theme-text-primary">
        {/* Names the track on screen: the keyboard itself carries no track
            identity, so without this there is no way to tell which hand it is. */}
        Piano{trackName ? ` — ${trackName}` : ''}
      </span>
      <div className="flex-1" />
      <Tooltip content={collapsed ? 'Expand piano keyboard' : 'Collapse piano keyboard'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={collapsed ? 'Expand piano keyboard' : 'Collapse piano keyboard'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          className="h-auto w-auto p-1 text-sm leading-none"
        >
          {collapsed ? '▴' : '▾'}
        </Button>
      </Tooltip>
    </div>
  );

  // Collapsed: the header alone, so the expand control survives.
  if (collapsed) return <div className="flex flex-col">{header}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div ref={boxRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div
          role="img"
          aria-label="Piano keyboard showing the notes being played"
          className="relative"
          style={{ width: keyboardWidth(whiteKeyWidth), height: box.height + LABEL_GUTTER }}
        >
          {keys.map((key) => {
            const isLit = lit.has(key.midi);
            return (
              <div
                key={key.midi}
                data-testid={`piano-key-${key.midi}`}
                data-playing={isLit ? 'true' : 'false'}
                style={{
                  position: 'absolute',
                  left: key.x,
                  top: 0,
                  width: key.width,
                  height: key.height,
                  backgroundColor: isLit
                    ? theme.notePlaying
                    : key.isBlack
                      ? '#1f1f23'
                      : '#fbfbfd',
                  border: '1px solid rgba(0,0,0,0.45)',
                  borderTop: 'none',
                  borderRadius: '0 0 3px 3px',
                  boxSizing: 'border-box',
                  // The non-color half of the cue (spec §27): a lit key is
                  // drawn *pressed*. That reads in grayscale, and it is the
                  // physically right metaphor for a struck key.
                  transform: isLit ? 'translateY(2px)' : undefined,
                  boxShadow: isLit ? 'inset 0 2px 4px rgba(0,0,0,0.45)' : undefined,
                }}
              >
                {key.label && (
                  <span
                    className="pointer-events-none absolute left-0 w-full text-center text-[9px] text-theme-text-secondary"
                    style={{ top: key.height + 1 }}
                  >
                    {key.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
