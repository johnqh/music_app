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
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from '@sudobility/components';
import { findTrack, gmInstrument, selectActiveTrackId, useAppStore } from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { resolveColorScheme } from '@/app/theme';
import type { PianoKey } from '@/features/piano-keyboard/keyboard-geometry';
import {
  MIN_WHITE_KEY_WIDTH,
  WHITE_KEY_COUNT,
  computeKeys,
  keyboardWidth,
} from '@/features/piano-keyboard/keyboard-geometry';
import { playingPitchesForTrack } from '@/features/piano-keyboard/playing-pitches';

/**
 * One key. `React.memo` on primitive props matters here: a note boundary
 * changes the lit state of one or two keys, and without this React re-applied
 * inline styles to all 88 on every one — `setValueForStyles` was visible in
 * the playback profile.
 */
const PianoKeyDiv = memo(function PianoKeyDiv({
  midi,
  isBlack,
  x,
  width,
  height,
  label,
  isLit,
  litColor,
}: PianoKey & { isLit: boolean; litColor: string }) {
  return (
    <div
      data-testid={`piano-key-${midi}`}
      data-playing={isLit ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: x,
        top: 0,
        width,
        height,
        backgroundColor: isLit ? litColor : isBlack ? '#1f1f23' : '#fbfbfd',
        border: '1px solid rgba(0,0,0,0.45)',
        borderTop: 'none',
        borderRadius: '0 0 3px 3px',
        boxSizing: 'border-box',
        // The non-color half of the cue (spec §27): a lit key is drawn
        // *pressed*. That reads in grayscale, and it is the physically right
        // metaphor for a struck key.
        transform: isLit ? 'translateY(2px)' : undefined,
        boxShadow: isLit ? 'inset 0 2px 4px rgba(0,0,0,0.45)' : undefined,
      }}
    >
      {label && (
        <span
          className="pointer-events-none absolute left-0 w-full text-center text-[9px] text-theme-text-secondary"
          style={{ top: height + 1 }}
        >
          {label}
        </span>
      )}
    </div>
  );
});

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

  const activeTrack = activeTrackId && score ? findTrack(score, activeTrackId) : null;
  /**
   * The instrument, not the literal word "Piano": the keyboard is a view of
   * whichever track is active, and that track is frequently not a piano.
   * Falls back to the track's own name when the program has no catalogue entry
   * (a hand-edited score), and to "Keyboard" when there is no score.
   */
  const headerLabel = activeTrack
    ? (gmInstrument(activeTrack.midiProgram)?.name ?? activeTrack.name)
    : 'Keyboard';

  const header = (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-theme-border px-2"
      style={{ height: HEADER_HEIGHT }}
    >
      {activeTrack && <InstrumentIcon program={activeTrack.midiProgram} className="size-4 shrink-0" />}
      <span className="text-xs font-medium text-theme-text-primary">
        {/* The keyboard carries no track identity of its own, so the header is
            the only thing telling you which part you are looking at. */}
        {headerLabel}
        {activeTrack ? ` — ${activeTrack.name}` : ''}
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
      <div ref={boxRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-contain">
        <div
          role="img"
          aria-label="Piano keyboard showing the notes being played"
          className="relative"
          style={{ width: keyboardWidth(whiteKeyWidth), height: box.height + LABEL_GUTTER }}
        >
          {keys.map((key) => (
            <PianoKeyDiv
              key={key.midi}
              {...key}
              isLit={lit.has(key.midi)}
              litColor={theme.notePlaying}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
