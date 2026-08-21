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
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@sudobility/components';
import {
  findTrack,
  midiToPitch,
  playbackController,
  selectActiveTrackId,
  trackInstrumentLabel,
  trackKeyboardRange,
  useAppStore,
  pitchToMidi,
  selectSelectedNotes,
} from '@sudobility/music_lib';
import { deleteEvents, insertChordAtCaret } from '@/features/score-editor/editing';
import { chordSelection } from '@/features/piano-keyboard/selection-editing';
import { durationForTap } from '@/features/piano-keyboard/tap-to-note';
import { getAppServices } from '@/config/initialize';
import { useSoundingNotes } from '@/features/score-editor/usePlayback';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { resolveColorScheme } from '@/app/theme';
import type { KeyNaming, PianoKey } from '@/features/piano-keyboard/keyboard-geometry';
import {
  LABEL_ROW_HEIGHT,
  MIN_WHITE_KEY_WIDTH,
  FULL_RANGE,
  computeKeys,
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
  name,
  labelTop,
  isLit,
  litColor,
  isSelected,
  selectedColor,
  onPress,
  onRelease,
}: PianoKey & {
  isLit: boolean;
  litColor: string;
  isSelected: boolean;
  selectedColor: string;
  onPress: (midi: number) => void;
  onRelease: (midi: number) => void;
}) {
  return (
    <div
      data-testid={`piano-key-${midi}`}
      data-playing={isLit ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      role="button"
      // What the key sounds, not "Play C4": every key would otherwise match a
      // search for the transport's Play button, and a key's accessible name
      // should be what it sounds — which on a drum track is a drum, not a
      // pitch. `name` carries whichever applies.
      aria-label={name}
      onPointerDown={(event) => {
        event.preventDefault();
        // Capture keeps the release on this key when a finger slides off it,
        // but it is an enhancement, not a precondition for sounding the note.
        // `?.` only guards the method being absent; it still throws for a
        // pointer the browser no longer considers active, and that exception
        // used to abort the handler before `onPress` — swallowing the key
        // press entirely.
        try {
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        } catch {
          // Nothing to do: the key still sounds and still writes its note.
        }
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
        // Sounding wins over selected: it is the more transient signal, and a
        // key that is both should show what is happening now.
        backgroundColor: isLit
          ? litColor
          : isSelected
            ? selectedColor
            : isBlack
              ? '#1f1f23'
              : '#fbfbfd',
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
          // `whitespace-nowrap` with the span centred on the key: a drum name
          // is wider than the key it belongs to, so it has to overhang rather
          // than wrap into the row below and collide with it.
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[9px] text-theme-text-secondary"
          style={{ top: labelTop }}
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

type KeyRowProps = {
  store: EditorStoreApi;
  keys: ReturnType<typeof computeKeys>;
  activeTrackId: string | null;
  heldKeys: ReadonlySet<number>;
  selectedMidis: ReadonlySet<number>;
  litColor: string;
  selectedColor: string;
  onPress: (midi: number) => void;
  onRelease: (midi: number) => void;
};

/**
 * The keys, and the ONLY part of the keyboard that subscribes to
 * `activeNoteIds`.
 *
 * Same rule the playback caret and the transport readouts follow: the store
 * reports sounding notes on every note-on and note-off, and reading that in
 * the panel above re-rendered the whole 400-line component — reconciling all
 * 88 keys — for each one, on the same thread Tone.js schedules from and the
 * caret animates on. The keys themselves are already `memo`'d on primitives,
 * so only the one or two that actually change do any work.
 */
const PianoKeyRow = memo(function PianoKeyRow({
  store,
  keys,
  activeTrackId,
  heldKeys,
  selectedMidis,
  litColor,
  selectedColor,
  onPress,
  onRelease,
}: KeyRowProps) {
  const sounding = useSoundingNotes();
  const playbackState = store((s) => s.state);

  /**
   * Gated on `playbackState`, not just on the set being non-empty: the engine
   * clears sounding notes on `stop()` but not on `pause()`, so without the gate
   * a pause would leave whatever was mid-chord stuck lit.
   *
   * The notes arrive with their track and pitch already resolved, so this is a
   * filter. It used to call `findEvent` per sounding note — a linear scan of
   * every track, measure and voice in the score, twenty times a second.
   */
  const lit = useMemo(() => {
    if (playbackState !== 'playing') return new Set<number>();
    return playingPitchesForTrack(sounding, activeTrackId);
  }, [playbackState, sounding, activeTrackId]);

  return (
    <>
      {keys.map((key) => (
        <PianoKeyDiv
          key={key.midi}
          {...key}
          isLit={lit.has(key.midi) || heldKeys.has(key.midi)}
          litColor={litColor}
          isSelected={selectedMidis.has(key.midi)}
          selectedColor={selectedColor}
          onPress={onPress}
          onRelease={onRelease}
        />
      ))}
    </>
  );
});

export function PianoKeyboardView({
  store = useAppStore,
  collapsed = false,
  onToggleCollapsed = () => undefined,
}: PianoKeyboardViewProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
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
        // The raw box. The label gutter is subtracted at render time instead of
        // here: a drum track labels its black keys too, on a second row, and
        // that is not known at measure time. Baking one gutter in here meant
        // the taller one overflowed a container that clips vertically, and the
        // black keys' names were cut off entirely.
        height: Math.max(1, el.clientHeight || FALLBACK_KEY_HEIGHT),
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
  /**
   * The two fields every instrument lookup here depends on, pulled out as
   * primitives.
   *
   * Deliberate: memoizing on the track object would recompute the whole key
   * geometry on any score edit, since a new score means a new track object.
   * These two are what actually decide it — and both are needed, because
   * `midiProgram` means a drum kit or an instrument depending on the clef.
   */
  const trackProgram = activeTrack?.midiProgram;
  const trackClef = activeTrack?.clef;

  const range = useMemo(() => {
    // Through the track, not the program alone: on a percussion track
    // `midiProgram` is a drum kit, so reading it as an instrument showed a
    // piano's compass for a kit — keys that could not sound a drum, and the
    // drums that do sound (35-81) partly off the end.
    if (trackProgram === undefined || trackClef === undefined) return snapToWhiteKeys(FULL_RANGE);
    return snapToWhiteKeys(trackKeyboardRange({ clef: trackClef, midiProgram: trackProgram }));
  }, [trackProgram, trackClef]);

  /**
   * Keys currently held by the pointer, and when each went down.
   *
   * The timestamps live in a ref because nothing renders from them; only the
   * set of held keys is state, so a held key can be drawn pressed.
   */
  const heldSinceRef = useRef(new Map<number, number>());
  /**
   * The notes of the chord currently being played, and when the first of them
   * went down.
   *
   * Keys pressed while another is still held belong to one chord, and the
   * whole group is written when the last of them lifts — which is simply what
   * playing a chord is. Accumulating here rather than writing per release is
   * what makes that possible: a note written on its own release has already
   * chosen a start tick and a duration, and cannot retroactively join anything.
   */
  const chordRef = useRef<{ midis: number[]; firstPressAt: number } | null>(null);

  /**
   * The selected chord, when the selection is exactly one — the keyboard's
   * second job. With one of these the keys toggle its pitches instead of
   * entering notes; without, they enter as before.
   */
  const selectedNotes = store(selectSelectedNotes);
  const editableChord = useMemo(() => chordSelection(selectedNotes), [selectedNotes]);
  const selectedMidis = useMemo(
    () => new Set((editableChord?.notes ?? []).map((note) => pitchToMidi(note.pitch))),
    [editableChord],
  );
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<number>>(() => new Set());

  const pressKey = useCallback(
    (midi: number) => {
      const now = performance.now();
      heldSinceRef.current.set(midi, now);
      const group = chordRef.current;
      if (group) {
        if (!group.midis.includes(midi)) group.midis.push(midi);
      } else {
        chordRef.current = { midis: [midi], firstPressAt: now };
      }
      setHeldKeys((held) => new Set(held).add(midi));
      // Sound it immediately. This is an audition, not transport playback: it
      // must be heard whether or not a score is loaded or playing.
      // The clef is as load-bearing as the program: it decides whether that
      // number is an instrument or a drum kit, so a stale one auditions a
      // pitched instrument for a note that plays back as a drum.
      playbackController.noteOn(midi, trackProgram ?? 0, trackClef === 'percussion');
    },
    [trackProgram, trackClef],
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

      // Nothing is written until every key of the group is up: until then the
      // player may still be adding notes to the same chord.
      if (heldSinceRef.current.size > 0) return;

      const group = chordRef.current;
      chordRef.current = null;
      if (!group || group.midis.length === 0) return;

      const score = store.getState().score;
      if (!score) return;
      const bpm = score.tempoMap[0]?.bpm ?? 120;
      // Wrapped, not point-free: `map` would pass the index into
      // `midiToPitch`'s key-signature parameter.
      const pitches = group.midis.map((midi) => midiToPitch(midi));

      // With one chord selected the keyboard edits it rather than entering
      // notes: a lit key removes its note, an unlit one joins the chord. The
      // two jobs are exclusive — doing both would add a note and also move on.
      if (editableChord) {
        // The chord's own tick, not wherever the caret happens to be, or an
        // added note lands somewhere the player never pointed at.
        playbackController.seek(editableChord.startTick);
        for (const midi of group.midis) {
          const existing = editableChord.notes.find((note) => pitchToMidi(note.pitch) === midi);
          if (existing) deleteEvents(store, [existing.id]);
          else
            insertChordAtCaret(store, [midiToPitch(midi)], { advanceCaret: false, mode: 'stack' });
        }
        return;
      }

      // Written as long as the group was held, snapped to a duration the
      // toolbar could also have produced. One length for the whole chord, from
      // the first key down to the last key up: measuring each key separately
      // would give notes that differ by milliseconds, and same-start notes with
      // differing durations delete each other rather than stacking.
      insertChordAtCaret(store, pitches, {
        duration: durationForTap(performance.now() - group.firstPressAt, bpm),
        advanceCaret: true,
      });
    },
    [store, editableChord],
  );

  /**
   * A MIDI keyboard plays into exactly the same handlers as the on-screen one.
   *
   * Routed through `pressKey`/`releaseKey` rather than writing notes directly,
   * so everything the on-screen keys already do comes with it: the note
   * sounds while held, a chord struck together is grouped, the held time
   * becomes the duration, and the caret advances past what was written. A
   * second path would have been a second set of those rules to keep in step.
   *
   * Subscribing is unconditional and harmless where there is no MIDI: an
   * unsupported platform returns an unsubscribe that never delivered anything.
   */
  useEffect(() => {
    const midiInput = getAppServices().io.midiInput;
    if (!midiInput.isSupported()) return;
    return midiInput.subscribe((event) => {
      if (event.type === 'on') pressKey(event.note);
      else releaseKey(event.note);
    });
  }, [pressKey, releaseKey]);

  const whiteKeyWidth = Math.max(MIN_WHITE_KEY_WIDTH, box.width / whiteKeyCount(range));
  /**
   * A drum track's keys are drums, so they are named as drums — and every one
   * of them is labelled, since a drum name cannot be inferred from a landmark
   * the way a pitch name can.
   */
  const naming: KeyNaming = trackClef === 'percussion' ? 'percussion' : 'pitch';
  /** Two rows of labels for a kit — the blacks are named too, and need their own line. */
  const labelGutter = naming === 'percussion' ? LABEL_ROW_HEIGHT * 2 : LABEL_GUTTER;
  /** What is left for the keys themselves once the labels have their rows. */
  const keyHeight = Math.max(1, box.height - labelGutter);
  const keys = useMemo(
    () => computeKeys(whiteKeyWidth, keyHeight, range, naming),
    [whiteKeyWidth, keyHeight, range, naming],
  );

  /**
   * The instrument, not the literal word "Piano": the keyboard is a view of
   * whichever track is active, and that track is frequently not a piano — and
   * on a percussion track it is a drum kit rather than an instrument at all.
   * Falls back to the track's own name when the program has no catalogue entry
   * (a hand-edited score), and to "Keyboard" when there is no score.
   */
  const headerLabel = activeTrack
    ? (trackInstrumentLabel(activeTrack) ?? activeTrack.name)
    : 'Keyboard';

  const header = (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-theme-border px-2"
      style={{ height: HEADER_HEIGHT }}
    >
      {activeTrack && <InstrumentIcon track={activeTrack} className="size-4 shrink-0" />}
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
      <div
        ref={boxRef}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-contain"
      >
        <div
          role="img"
          aria-label={t('editor.pianoKeyboard')}
          className="relative"
          style={{ width: keyboardWidth(whiteKeyWidth), height: box.height }}
        >
          <PianoKeyRow
            store={store}
            keys={keys}
            activeTrackId={activeTrackId}
            heldKeys={heldKeys}
            selectedMidis={selectedMidis}
            litColor={theme.notePlaying}
            selectedColor={theme.noteSelected}
            onPress={pressKey}
            onRelease={releaseKey}
          />
        </div>
      </div>
    </div>
  );
}
