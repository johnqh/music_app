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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from '@sudobility/components';
import {
  findTrack,
  gmInstrument,
  gmInstrumentRange,
  midiToPitch,
  playbackController,
  selectActiveTrackId,
  useAppStore,
} from '@sudobility/music_lib';
import { insertNoteAtCaret } from '@/features/score-editor/editing';
import { durationForTap } from '@/features/piano-keyboard/tap-to-note';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { resolveColorScheme } from '@/app/theme';
import type { PianoKey } from '@/features/piano-keyboard/keyboard-geometry';
import {
  MIN_WHITE_KEY_WIDTH,
  FULL_RANGE,
  computeKeys,
  noteLabel,
  keyboardWidth,
  snapToWhiteKeys,
  whiteKeyCount,
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
  onPress,
  onRelease,
}: PianoKey & {
  isLit: boolean;
  litColor: string;
  onPress: (midi: number) => void;
  onRelease: (midi: number) => void;
}) {
  return (
    <div
      data-testid={`piano-key-${midi}`}
      data-playing={isLit ? 'true' : 'false'}
      role="button"
      // The note itself, not "Play C4": every key would otherwise match a
      // search for the transport's Play button, and a key's accessible name
      // should be the note it sounds.
      aria-label={noteLabel(midi)}
      onPointerDown={(event) => {
        event.preventDefault();
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        onPress(midi);
      }}
      onPointerUp={() => onRelease(midi)}
      // A pointer that leaves the key still has to release it, or the note
      // sustains forever and the tap never gets written.
      onPointerCancel={() => onRelease(midi)}
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
        cursor: 'pointer',
        touchAction: 'none',
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

  const activeTrack = activeTrackId && score ? findTrack(score, activeTrackId) : null;

  /**
   * The keyboard spans the active track's instrument, not always all 88 keys —
   * a piccolo part should not present three octaves that will never sound. It
   * follows a track change and an instrument change alike, because both move
   * `midiProgram`.
   *
   * Widened to whole keys first: a keyboard whose outermost key is black has
   * nothing for that key to hang off, so it would float.
   */
  const range = useMemo(() => {
    const program = activeTrack?.midiProgram;
    return snapToWhiteKeys(program === undefined ? FULL_RANGE : gmInstrumentRange(program));
  }, [activeTrack?.midiProgram]);

  /**
   * Keys currently held by the pointer, and when each went down.
   *
   * The timestamps live in a ref because nothing renders from them; only the
   * set of held keys is state, so a held key can be drawn pressed.
   */
  const heldSinceRef = useRef(new Map<number, number>());
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<number>>(() => new Set());

  const pressKey = useCallback(
    (midi: number) => {
      heldSinceRef.current.set(midi, performance.now());
      setHeldKeys((held) => new Set(held).add(midi));
      // Sound it immediately. This is an audition, not transport playback: it
      // must be heard whether or not a score is loaded or playing.
      playbackController.noteOn(midi, activeTrack?.midiProgram ?? 0);
    },
    [activeTrack?.midiProgram],
  );

  const releaseKey = useCallback(
    (midi: number) => {
      const since = heldSinceRef.current.get(midi);
      heldSinceRef.current.delete(midi);
      setHeldKeys((held) => {
        if (!held.has(midi)) return held;
        const next = new Set(held);
        next.delete(midi);
        return next;
      });
      playbackController.noteOff(midi);
      if (since === undefined) return;

      // Written as long as it was held, snapped to a duration the toolbar could
      // also have produced.
      const score = store.getState().score;
      if (!score) return;
      const bpm = score.tempoMap[0]?.bpm ?? 120;
      insertNoteAtCaret(store, midiToPitch(midi), {
        duration: durationForTap(performance.now() - since, bpm),
        advanceCaret: true,
      });
    },
    [store],
  );

  const whiteKeyWidth = Math.max(MIN_WHITE_KEY_WIDTH, box.width / whiteKeyCount(range));
  const keys = useMemo(
    () => computeKeys(whiteKeyWidth, box.height, range),
    [whiteKeyWidth, box.height, range],
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
              isLit={lit.has(key.midi) || heldKeys.has(key.midi)}
              litColor={theme.notePlaying}
              onPress={pressKey}
              onRelease={releaseKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
