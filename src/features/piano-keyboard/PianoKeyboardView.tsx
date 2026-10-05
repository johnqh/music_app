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
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findTrack,
  litKeys,
  playbackController,
  selectActiveTrackId,
  useAppStore,
  midiIsInRange,
  pitchToMidi,
  selectSelectedNotes,
} from '@/app-library';
import type { SoundingNote, UUID } from '@/app-library';
// `chordSelection` for what the keys should *look* like; `playKeyGroup` for
// what pressing them does. Only the first is this component's business.
import {
  EMPTY_GROUP,
  chordSelection,
  playKeyGroup,
  pressKey as pressGroupKey,
  releaseKey as releaseGroupKey,
} from '@/app-library';
import type { KeyGroup } from '@/app-library';
import type { RenderTheme } from '@sudobility/music_drawing';
import { getAppServices } from '@/config/initialize';
import { usePlayingPitches } from '@/features/score-editor/usePlayback';
import type { EditorStoreApi } from '@/app-library';
import {
  DARK_RENDER_THEME,
  LIGHT_RENDER_THEME,
  KEYBOARD_SCROLL_INDICATOR_HEIGHT,
  keyboardScrollIndicator,
  keyboardScrollStart,
  KineticScroller,
} from '@sudobility/music_drawing';
import { useResolvedColorScheme } from '@/app/theme';
import type { PianoKey } from '@sudobility/music_drawing';
import { keyboardKeyFill, keyboardKeys } from '@sudobility/music_drawing';
import { auditionVoiceFor } from '@sudobility/music_types';

/**
 * One key. `React.memo` on primitive props matters here: a note boundary
 * changes the lit state of one or two keys, and without this React re-applied
 * inline styles to all 88 on every one — `setValueForStyles` was visible in
 * the playback profile.
 */
const PianoKeyDiv = memo(function PianoKeyDiv({
  midi,
  x,
  width,
  height,
  label,
  name,
  labelTop,
  outOfRange,
  isLit,
  isSelected,
  fill,
  onPress,
  onRelease,
}: PianoKey & {
  isLit: boolean;
  isSelected: boolean;
  /** The key's colour, from `keyboardKeyFill` — a string, so `memo` still compares a primitive. */
  fill: string;
  onPress: (midi: number, shiftKey: boolean) => void;
  onRelease: (midi: number, shiftKey: boolean) => void;
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
      // Drawn because the track holds notes here, but the instrument cannot
      // play it — so it neither sounds nor writes.
      aria-disabled={outOfRange || undefined}
      onPointerDown={(event) => {
        event.preventDefault();
        if (outOfRange) return;
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
        onPress(midi, event.shiftKey);
      }}
      onPointerUp={outOfRange ? undefined : (event) => onRelease(midi, event.shiftKey)}
      // A pointer that leaves the key still has to release it, or the note
      // sustains forever and the tap never gets written.
      onPointerCancel={outOfRange ? undefined : (event) => onRelease(midi, event.shiftKey)}
      style={{
        position: 'absolute',
        left: x,
        top: 0,
        width,
        height,
        backgroundColor: fill,
        border: '1px solid rgba(0,0,0,0.45)',
        borderTop: 'none',
        borderRadius: '0 0 3px 3px',
        boxSizing: 'border-box',
        // The non-color half of the cue (spec §27): a lit key is drawn
        // *pressed*. That reads in grayscale, and it is the physically right
        // metaphor for a struck key.
        transform: isLit ? 'translateY(2px)' : undefined,
        boxShadow: isLit ? 'inset 0 2px 4px rgba(0,0,0,0.45)' : undefined,
        cursor: outOfRange ? 'default' : 'pointer',
        // A finger on a key plays it; scrolling is the strip under the keys.
        touchAction: 'none',
      }}
    >
      {label && (
        <span
          // `whitespace-nowrap` with the span centred on the key: a drum name
          // is wider than the key it belongs to, so it has to overhang rather
          // than wrap into the row below and collide with it.
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[9px] text-muted-foreground"
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
  /**
   * Whether the panel is collapsed.
   *
   * Only to skip the work of drawing when it is: the *control* is the transport
   * bar's now, so this view no longer offers one. It used to carry a header row
   * of its own holding one button, which is a whole row for a control that also
   * sat inside the thing it reveals.
   */
  collapsed?: boolean;
};

/** Used when the panel isn't measurable (jsdom reports 0), so tests get real geometry. */
const FALLBACK_WIDTH = 1000;
const FALLBACK_KEY_HEIGHT = 96;

type KeyRowProps = {
  store: EditorStoreApi;
  keys: PianoKey[];
  activeTrackId: string | null;
  heldKeys: ReadonlySet<number>;
  selectedMidis: ReadonlySet<number>;
  theme: RenderTheme;
  onPress: (midi: number, shiftKey: boolean) => void;
  onRelease: (midi: number, shiftKey: boolean) => void;
};

/**
 * The keys, and the ONLY part of the keyboard that subscribes to the sounding
 * notes.
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
  theme,
  onPress,
  onRelease,
}: KeyRowProps) {
  // The same set until one of this track's keys changes, so a note starting on
  // another part renders nothing here.
  const playing = usePlayingPitches(activeTrackId);
  const playbackState = store((s) => s.state);

  /*
    What is drawn pressed is music_drawing's `litKeys`, shared with the native
    keyboard: the active track's sounding pitches **only while playing** — the
    engine clears sounding notes on `stop()` but not on `pause()`, so without
    the gate a paused chord stayed lit — plus the keys a finger holds.

    Fed from `usePlayingPitches` rather than the raw sounding notes, and
    memoized on it. The rule wants notes, but reading the notes here would hand
    it a new array on every report from every track and rebuild the set each
    time; the kept set only changes identity when one of this track's keys
    does, so the lit set below does too, and a note starting on another part
    still renders nothing.
  */
  const lit = useMemo(
    () => litKeys(asSounding(playing, activeTrackId), activeTrackId, playbackState, heldKeys),
    [playing, activeTrackId, playbackState, heldKeys],
  );

  return (
    <>
      {keys.map((key) => {
        const isLit = lit.has(key.midi);
        const isSelected = selectedMidis.has(key.midi);
        return (
          <PianoKeyDiv
            key={key.midi}
            {...key}
            isLit={isLit}
            isSelected={isSelected}
            // Sounding over selected over the out-of-range dimming — black keys
            // included, which the web used to draw the same near-black whether
            // or not the instrument could play them.
            fill={keyboardKeyFill(key, { lit: isLit, selected: isSelected }, theme)}
            onPress={onPress}
            onRelease={onRelease}
          />
        );
      })}
    </>
  );
});

/** The kept pitch set, in the shape `litKeys` reads: already this track's. */
function asSounding(pitches: ReadonlySet<number>, trackId: UUID | null): SoundingNote[] {
  if (!trackId) return [];
  return [...pitches].map((midi) => ({ noteId: '', trackId, midi }));
}

export function PianoKeyboardView({
  store = useAppStore,
  collapsed = false,
}: PianoKeyboardViewProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const activeTrackId = store(selectActiveTrackId);
  const themeMode = store((s) => s.themeMode);
  /*
    What the staff is showing, which is the only thing that moves the key
    LETTERING. Its own narrow subscription, like every other read here.
  */
  const pitchDisplay = store((s) => s.pitchDisplay);

  // Observed rather than resolved once: in system mode an OS flip does not
  // change `themeMode`, and the key fills are literal colours CSS cannot reach.
  const scheme = useResolvedColorScheme(themeMode);
  const theme = scheme === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME;

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

  /*
    The keys, their size, their names and where the labels go — one call,
    `keyboardKeys` in music_drawing, shared with the native keyboard. It folds
    in what this view used to compose from five helpers:

    - the range: the active track's instrument, not always all 88 keys (a
      piccolo part should not present three octaves that will never sound),
      widened to reach every note the track holds — an import can hold notes
      the instrument cannot play, and a keyboard stopped at the compass lit
      nothing for them — and snapped to whole white keys, since a black key at
      either end has nothing to hang off. Keys outside the compass are marked.
      Through the track, not the program alone: on a percussion track
      `midiProgram` is a drum kit;
    - the naming: a drum track's keys are drums, every one labelled on two
      rows, since a drum name cannot be inferred from a landmark the way a pitch
      name can;
    - the label gutter, taken out of the measured height — not baked in at
      measure time, where a drum track's taller gutter overflowed a container
      that clips vertically and cut the black keys' names off;
    - the lettering of a transposing part read in written pitch. Only the names
      move: the midi numbers stay sounding, because that is what the store
      holds, what the audition plays, what lights and what note entry writes.
      On a B-flat trumpet the key that reads C4 is the sounding B-flat 3 the
      player writes as C;
    - the width of *this* range, which is what the scrolling box is sized to:
      white keys are `WHITE_KEY_WIDTH` (44) on every platform, so a keyboard
      narrower than the panel is centred and a wider one scrolls.

    Recomputed when the track changes, which a note edit does; it walks the
    track's notes once, which is nothing next to drawing the keys.
  */
  const keyboard = useMemo(
    () =>
      keyboardKeys({
        height: box.height,
        track: activeTrack,
        pitchDisplay,
      }),
    [box.height, activeTrack, pitchDisplay],
  );
  const { playable, keys } = keyboard;

  /**
   * The voice a key auditions on, pulled out as primitives, so the press
   * handler is not rebuilt on every score edit. `auditionVoiceFor` reads the
   * clef as well as the program — `midiProgram` means a drum kit or an
   * instrument depending on it — and resolves a percussion address to the kit
   * playback would use; the native keyboard asks the same function.
   */
  const { program: auditionProgram, isPercussion: auditionPercussion } =
    auditionVoiceFor(activeTrack);

  /**
   * The chord being played: which keys, which are still down, and when it began.
   *
   * Keys pressed while another is still held belong to one chord, and the whole
   * group is written when the last of them lifts — which is simply what playing
   * a chord is. Accumulating rather than writing per release is what makes that
   * possible: a note written on its own release has already chosen a start tick
   * and a duration, and cannot retroactively join anything.
   *
   * The rule itself is `pressKey`/`releaseKey`, shared with the React Native
   * app. It used to be written out here instead, against a `{midis,
   * firstPressAt}` object and a separate map of press times — a second
   * statement of what counts as one chord, inside a component, where it could
   * not be tested without a renderer.
   *
   * A ref because nothing renders from it; the *held* set is state, so a held
   * key can be drawn pressed.
   */
  const groupRef = useRef<KeyGroup>(EMPTY_GROUP);
  const shiftGroupRef = useRef(false);

  /**
   * The selected chord, when the selection is exactly one — the keyboard's
   * second job. Shift-click toggles a pitch in it; a plain click changes a
   * single selected note's pitch.
   */
  const selectedNotes = store(selectSelectedNotes);
  const editableChord = useMemo(() => chordSelection(selectedNotes), [selectedNotes]);
  const selectedMidis = useMemo(
    () => new Set((editableChord?.notes ?? []).map((note) => pitchToMidi(note.pitch))),
    [editableChord],
  );
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<number>>(() => new Set());

  const pressKey = useCallback(
    (midi: number, shiftKey = false) => {
      // Out of the instrument's compass: neither sounded nor written. The
      // drawn key is inert already; this is the MIDI keyboard's route in.
      if (playable && !midiIsInRange(midi, playable)) return;
      if (groupRef.current.down.length === 0) shiftGroupRef.current = shiftKey;
      groupRef.current = pressGroupKey(groupRef.current, midi, performance.now());
      setHeldKeys((held) => new Set(held).add(midi));
      // Sound it immediately. This is an audition, not transport playback: it
      // must be heard whether or not a score is loaded or playing.
      playbackController.noteOn(midi, auditionProgram, auditionPercussion);
    },
    [auditionProgram, auditionPercussion, playable],
  );

  const releaseKey = useCallback(
    (midi: number, shiftKey = false) => {
      // Desktop browsers report modifiers on both ends of a pointer gesture.
      // Keep either report so a shifted release still edits the chord.
      shiftGroupRef.current ||= shiftKey;
      setHeldKeys((held) => {
        if (!held.has(midi)) return held;
        const next = new Set(held);
        next.delete(midi);
        return next;
      });
      playbackController.noteOff(midi);

      // `finished` is set only once the last finger lifts: until then the
      // player may still be adding notes to the same chord.
      const { group, finished } = releaseGroupKey(groupRef.current, midi, performance.now());
      groupRef.current = group;
      if (!finished) return;

      // One call, because it is one user action. Which of the two things it
      // means — writing a chord at the caret, or toggling the pitches of a
      // selected one — is a rule about editing, and lives with the editing.
      playKeyGroup(store, { ...finished, toggleSelected: shiftGroupRef.current });
      shiftGroupRef.current = false;
    },
    [store],
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

  /*
    Where the keyboard is scrolled to, for the indicator under the strip. The
    browser's scrollbar is hidden: across a panel 160 high it was a full bar of
    chrome for something a drag in the strip already does.
  */
  const [scrollLeft, setScrollLeft] = useState(0);
  const indicator = keyboardScrollIndicator(box.width, keyboard.width, scrollLeft);

  /*
    Drag-scrolling, from the strip under the keys (`labelGutter` in
    music_drawing): the one part of the board no key covers. A finger or a
    mouse on a key plays it, so this is the only way a touch screen scrolls a
    keyboard wider than the panel, and the only way a mouse drags one. A
    press that lands on a key never reaches here — the key's own handler takes
    it — so `target === currentTarget` is exactly "the strip".

    With momentum, as a touch screen scrolls: music_drawing's
    `KineticScroller` keeps it going after the pointer lets go, slowing down,
    and springs back from past either end. A browser does not scroll past an
    end, so that overscroll is drawn by shifting the board instead.
  */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const geometry = useRef({ view: box.width, content: keyboard.width });
  geometry.current = { view: box.width, content: keyboard.width };
  const kinetic = useMemo(
    () =>
      new KineticScroller({
        max: () => Math.max(0, geometry.current.content - geometry.current.view),
        viewport: () => geometry.current.view,
        apply: (position) => {
          const el = boxRef.current;
          if (!el) return;
          const max = Math.max(0, geometry.current.content - geometry.current.view);
          const scroll = Math.min(Math.max(position, 0), max);
          el.scrollLeft = scroll;
          if (boardRef.current) {
            const over = position - scroll;
            boardRef.current.style.transform = over === 0 ? '' : `translateX(${-over}px)`;
          }
          setScrollLeft(scroll);
        },
      }),
    [],
  );
  useEffect(() => () => kinetic.stop(), [kinetic]);

  /*
    A keyboard wider than the panel opens on its middle, as a narrower one is
    centred — again when its width changes, which a new instrument's range
    does, but not on every render: a reader who scrolled to the bass keeps it.
  */
  useEffect(() => {
    if (!boxRef.current) return;
    kinetic.jumpTo(keyboardScrollStart(box.width, keyboard.width));
  }, [kinetic, box.width, keyboard.width, collapsed]);

  const dragRef = useRef<{ pointerId: number; x: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onStripPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!boxRef.current || event.target !== event.currentTarget) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture only keeps the drag when the pointer leaves the strip.
      }
      dragRef.current = { pointerId: event.pointerId, x: event.clientX };
      kinetic.grab();
      setDragging(true);
    },
    [kinetic],
  );
  const onStripPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      kinetic.drag(event.clientX - drag.x);
    },
    [kinetic],
  );
  const onStripPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      kinetic.release();
      setDragging(false);
    },
    [kinetic],
  );

  // Nothing at all when collapsed. The control that brings it back lives on the
  // transport bar, so no part of this has to stay on screen to remain reachable
  // — which is what the header row it replaced was for.
  if (collapsed) return null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={boxRef}
        onScroll={(event) => {
          // A wheel or trackpad scroll, which the drag must start from next.
          kinetic.sync(event.currentTarget.scrollLeft);
          setScrollLeft(event.currentTarget.scrollLeft);
        }}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          ref={boardRef}
          role="img"
          aria-label={t('editor.pianoKeyboard')}
          // `mx-auto` centres a keyboard narrower than the panel; a wider one
          // leaves no margin and the box scrolls.
          className="relative mx-auto"
          style={{
            width: keyboard.width,
            height: box.height,
            cursor: dragging ? 'grabbing' : 'grab',
            // The browser's own panning would fight the drag below.
            touchAction: 'none',
          }}
          data-testid="piano-keyboard-board"
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerEnd}
          onPointerCancel={onStripPointerEnd}
        >
          <PianoKeyRow
            store={store}
            keys={keys}
            activeTrackId={activeTrackId}
            heldKeys={heldKeys}
            selectedMidis={selectedMidis}
            theme={theme}
            onPress={pressKey}
            onRelease={releaseKey}
          />
        </div>
      </div>
      {indicator ? (
        <div
          data-testid="piano-keyboard-scroll-indicator"
          aria-hidden
          className="pointer-events-none absolute bottom-0.5 rounded-full bg-muted-foreground/50"
          style={{
            left: indicator.left,
            width: indicator.width,
            height: KEYBOARD_SCROLL_INDICATOR_HEIGHT,
          }}
        />
      ) : null}
    </div>
  );
}
