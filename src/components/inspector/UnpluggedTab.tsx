/**
 * The Unplugged tab: an instrument arrangement on a stage, dragged into
 * place.
 *
 * The RN half of this pair lives at `music_app_rn/src/features/inspector/
 * UnpluggedTab.tsx`, using `react-native-gesture-handler` where this uses
 * `PointerEvent`s — the coordinate math (`toPixels`/`pixelsToStageDelta`)
 * and the whole rest of the design are the same; only the touch layer
 * differs. See that file's comment for the fuller design rationale:
 * why this reaches `bind-player.ts` through a shadow score rather than a
 * player API of its own, and why `unpluggedActive` is a store-only flag,
 * never persisted.
 *
 * **Every drag is drafted locally and throttled to one store write per
 * animation frame, not one per pointer event.** `dispatchCommand`
 * (`music_editing`) is not cheap: it runs Immer's `produceWithPatches` over
 * the *whole score* to record an undo entry, `validateScore` over the whole
 * score, and a `JSON.stringify` of the whole score twice (the dirty-check
 * fingerprint) — all real costs the Track tab's volume/pan sliders already
 * avoid by drafting locally and committing only on release. This tab still
 * wants the mix to move live while dragging, which a release-only commit
 * would not give, so it keeps writing to the store during the drag but caps
 * the rate at `requestAnimationFrame` — a pointer can report movement far
 * faster than the screen can repaint, and every one of those extra writes
 * was pure waste. The dragged marker's own on-screen position is local
 * `useState`, updated on every pointer event regardless, so it tracks the
 * cursor exactly even though the store lags a frame behind it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@sudobility/components';
import {
  controlLocked,
  selectEditLocked,
  effectiveUnpluggedArrangement,
  UNPLUGGED_RADIUS,
} from '@/app-library';
import type { Track } from '@sudobility/music_types';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { EditorStoreApi } from '@/app-library';

export type UnpluggedTabProps = {
  store: EditorStoreApi;
};

const STAGE_EXTENT = UNPLUGGED_RADIUS * 1.6;
/** How far the facing triangle sits from the listener's own centre. Close, so it reads as one marker rather than two unrelated dots. */
const HANDLE_DISTANCE = UNPLUGGED_RADIUS * 0.3;
const TRACK_TARGET = 40;
const LISTENER_TARGET = 28;
/** Arrow-key step sizes — a stage unit and a degree count small enough to nudge, not jump. */
const KEY_MOVE_STEP = UNPLUGGED_RADIUS * 0.1;
const KEY_TURN_STEP = 10;

function toPixels(stage: { x: number; z: number }, canvasSize: number) {
  return {
    x: ((stage.x + STAGE_EXTENT) / (2 * STAGE_EXTENT)) * canvasSize,
    y: canvasSize - ((stage.z + STAGE_EXTENT) / (2 * STAGE_EXTENT)) * canvasSize,
  };
}

function pixelsToStageDelta(dx: number, dy: number, canvasSize: number) {
  const scale = (2 * STAGE_EXTENT) / canvasSize;
  return { dx: dx * scale, dz: -dy * scale };
}

/**
 * One dragged value: tracked locally for instant visual feedback, written
 * to the store at most once per animation frame, and always written exactly
 * once more — synchronously — on release, so the store never ends up
 * holding a stale mid-drag position because the last rAF tick lost the
 * race with `pointerup`.
 */
function useThrottledDrag<T>(commit: (value: T) => void) {
  const [live, setLive] = useState<T | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<T | null>(null);

  const update = useCallback(
    (value: T) => {
      setLive(value);
      pendingRef.current = value;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingRef.current !== null) commit(pendingRef.current);
        });
      }
    },
    [commit],
  );

  const finish = useCallback(
    (value: T) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      commit(value);
      pendingRef.current = null;
      setLive(null);
    },
    [commit],
  );

  return { live, update, finish };
}

/**
 * One pointer-drag gesture. `setPointerCapture` is what `ScoreEditorView`'s
 * own canvas dragging uses — pointer events keep arriving for this element
 * even once the cursor leaves it, which a plain `onMouseMove` would not
 * give.
 */
function usePointerDrag(
  onDelta: (dx: number, dy: number, final: boolean) => void,
  disabled: boolean,
) {
  const last = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      last.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!last.current) return;
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };
      onDelta(dx, dy, false);
    },
    [onDelta],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      last.current = null;
      onDelta(0, 0, true);
    },
    [onDelta],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

/**
 * The listener's facing, tracked from the pointer's *current* position
 * relative to the listener's fixed centre — never from an accumulated
 * delta. A delta-based drag was the earlier bug: each frame recomputed the
 * triangle's "current" offset from `facingDeg` via trig and then added a
 * delta to *that*, so the angle compounded one frame's rounding into the
 * next rather than ever being re-derived from where the pointer actually
 * is. This instead asks one question, fresh, on every event: "at this
 * exact pointer position, what bearing is that from the centre?" — which
 * cannot drift, because it never depends on its own previous answer.
 */
function useTurnDrag(
  canvasRef: RefObject<HTMLDivElement | null>,
  centerPixels: () => { x: number; y: number },
  onBearing: (facingDeg: number, final: boolean) => void,
  disabled: boolean,
) {
  const bearingAt = useCallback(
    (event: ReactPointerEvent<HTMLElement>): number | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const center = centerPixels();
      const relX = event.clientX - rect.left - center.x;
      const relY = event.clientY - rect.top - center.y;
      if (relX === 0 && relY === 0) return null;
      // Same convention as `unpluggedMixFor`'s own bearing: 0° is up
      // (`+z`, screen-up since `toPixels` flips z into y), clockwise-positive.
      return (Math.atan2(relX, -relY) * 180) / Math.PI;
    },
    [canvasRef, centerPixels],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const facingDeg = bearingAt(event);
      if (facingDeg !== null) onBearing(facingDeg, false);
    },
    [bearingAt, onBearing],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      const facingDeg = bearingAt(event);
      if (facingDeg !== null) onBearing(facingDeg, true);
    },
    [bearingAt, onBearing],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

export function UnpluggedTab({ store }: UnpluggedTabProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const locked = store((s) => selectEditLocked(s) && controlLocked(s, 'unpluggedArrangement'));
  const [canvasSize, setCanvasSize] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Unplugged mixing is in effect for exactly as long as this tab is
  // mounted — never persisted, never true when nothing shows it.
  useEffect(() => {
    store.getState().setUnpluggedActive(true);
    return () => store.getState().setUnpluggedActive(false);
  }, [store]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // Width only: the stage is `aspect-square`, so height is derived from
    // width by CSS and needs no measuring of its own — `clientHeight`
    // measured through this panel's nested flex/Tabs ancestry is exactly
    // the kind of thing that can resolve to 0 depending on an ancestor
    // nobody thought to check.
    const measure = () => setCanvasSize(Math.max(1, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!score) return null;
  const arrangement = effectiveUnpluggedArrangement(score);

  /**
   * Arrow keys move and turn the listener — up/down step forward/backward
   * *relative to their own facing*, not along a fixed stage axis, which is
   * what makes "up" mean the same thing regardless of which way they're
   * currently turned; left/right turn in place. Scoped to this element's
   * own focus (`tabIndex`) rather than the whole document, so this does not
   * compete with the arrow-key behaviour the score editor's own canvas
   * already has elsewhere in the app.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const current = arrangement.listener;
    const facingRad = (current.facingDeg * Math.PI) / 180;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        store.getState().setUnpluggedListener({
          x: current.x + KEY_MOVE_STEP * Math.sin(facingRad),
          z: current.z + KEY_MOVE_STEP * Math.cos(facingRad),
        });
        return;
      case 'ArrowDown':
        event.preventDefault();
        store.getState().setUnpluggedListener({
          x: current.x - KEY_MOVE_STEP * Math.sin(facingRad),
          z: current.z - KEY_MOVE_STEP * Math.cos(facingRad),
        });
        return;
      case 'ArrowLeft':
        event.preventDefault();
        store.getState().setUnpluggedListener({ facingDeg: current.facingDeg - KEY_TURN_STEP });
        return;
      case 'ArrowRight':
        event.preventDefault();
        store.getState().setUnpluggedListener({ facingDeg: current.facingDeg + KEY_TURN_STEP });
        return;
      default:
        return;
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-2">
      <p className="text-xs text-theme-text-secondary">{t('inspector.unpluggedHint')}</p>
      <div
        ref={canvasRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative aspect-square w-full max-h-[360px] min-h-[240px] overflow-hidden rounded-lg border border-theme-border bg-theme-surface"
        aria-label={t('inspector.unpluggedStage')}
      >
        {canvasSize > 0 && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: canvasSize, height: canvasSize }}
          >
            {score.tracks.map((track) => {
              const point = arrangement.tracks[track.id];
              if (!point) return null;
              return (
                <TrackMarker
                  key={track.id}
                  track={track}
                  point={point}
                  canvasSize={canvasSize}
                  locked={locked}
                  onDrag={(next) => store.getState().setUnpluggedTrackPosition(track.id, next)}
                />
              );
            })}
            <ListenerMarker
              canvasRef={canvasRef}
              listener={arrangement.listener}
              canvasSize={canvasSize}
              locked={locked}
              label={t('inspector.unpluggedListener')}
              handleLabel={t('inspector.unpluggedTurnHandle')}
              onMove={(next) => store.getState().setUnpluggedListener(next)}
              onTurn={(facingDeg) => store.getState().setUnpluggedListener({ facingDeg })}
            />
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={locked}
        onClick={() => store.getState().resetUnpluggedArrangement()}
        className="w-full px-3 py-1.5 text-sm"
      >
        {t('inspector.unpluggedReset')}
      </Button>
    </div>
  );
}

function TrackMarker({
  track,
  point,
  canvasSize,
  locked,
  onDrag,
}: {
  track: Pick<Track, 'id' | 'name' | 'instrumentName' | 'clef' | 'midiProgram'>;
  point: { x: number; z: number };
  canvasSize: number;
  locked: boolean;
  onDrag: (next: { x: number; z: number }) => void;
}) {
  const pointRef = useRef(point);
  pointRef.current = point;

  const { live, update, finish } = useThrottledDrag<{ x: number; z: number }>(onDrag);

  const { onPointerDown, onPointerMove, onPointerUp } = usePointerDrag((dx, dy, final) => {
    const { dx: sx, dz: sz } = pixelsToStageDelta(dx, dy, canvasSize);
    const base = live ?? pointRef.current;
    const next = { x: base.x + sx, z: base.z + sz };
    pointRef.current = next;
    if (final) finish(next);
    else update(next);
  }, locked);

  const rendered = live ?? point;
  const pixels = toPixels(rendered, canvasSize);
  const letter = track.instrumentName.trim().charAt(0).toUpperCase();

  return (
    <div
      className="absolute"
      style={{
        left: pixels.x - TRACK_TARGET / 2,
        top: pixels.y - TRACK_TARGET / 2,
        width: TRACK_TARGET,
        height: TRACK_TARGET,
      }}
    >
      <button
        type="button"
        aria-label={track.name}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-0 flex items-center justify-center rounded-full border border-theme-border bg-theme-surface text-theme-text-primary shadow-sm"
        style={{ cursor: locked ? 'default' : 'grab', touchAction: 'none' }}
      >
        <InstrumentIcon track={track} className="size-5" />
      </button>
      {/*
        The letter is a label, not a control: it must not steal the pointer
        from the icon button underneath it. Sized to fit a real 14px
        character (`text-sm`) rather than shrunk to fit a smaller badge —
        the native app's own `legibility.test.ts` bans anything under that,
        and there's no reason this platform's copy should read smaller.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute flex h-5 w-5 items-center justify-center rounded-full border border-theme-surface bg-theme-text-primary text-sm font-semibold leading-none text-theme-bg-primary"
        style={{ right: -6, bottom: -6 }}
      >
        {letter}
      </span>
    </div>
  );
}

function ListenerMarker({
  canvasRef,
  listener,
  canvasSize,
  locked,
  label,
  handleLabel,
  onMove,
  onTurn,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  listener: { x: number; z: number; facingDeg: number };
  canvasSize: number;
  locked: boolean;
  label: string;
  handleLabel: string;
  onMove: (next: { x: number; z: number }) => void;
  onTurn: (facingDeg: number) => void;
}) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  const bodyThrottle = useThrottledDrag<{ x: number; z: number }>(onMove);
  const bodyDrag = usePointerDrag((dx, dy, final) => {
    const { dx: sx, dz: sz } = pixelsToStageDelta(dx, dy, canvasSize);
    const base = bodyThrottle.live ?? { x: listenerRef.current.x, z: listenerRef.current.z };
    const next = { x: base.x + sx, z: base.z + sz };
    if (final) bodyThrottle.finish(next);
    else bodyThrottle.update(next);
  }, locked);

  const turnThrottle = useThrottledDrag<number>(onTurn);
  // The centre the rotation is measured from — the body's own live position
  // if it happens to be mid-drag too, else the committed one. Read fresh on
  // every pointer event rather than captured once, since a body drag can in
  // principle be moving the centre while the facing is also being dragged.
  const turnCenter = useCallback(
    () => toPixels({ ...listenerRef.current, ...(bodyThrottle.live ?? {}) }, canvasSize),
    [bodyThrottle.live, canvasSize],
  );
  const turnDrag = useTurnDrag(
    canvasRef,
    turnCenter,
    (facingDeg, final) => {
      if (final) turnThrottle.finish(facingDeg);
      else turnThrottle.update(facingDeg);
    },
    locked,
  );

  const renderedListener = {
    ...listener,
    ...(bodyThrottle.live ?? {}),
    facingDeg: turnThrottle.live ?? listener.facingDeg,
  };
  const pixels = toPixels(renderedListener, canvasSize);
  const facingRad = (renderedListener.facingDeg * Math.PI) / 180;
  const handlePixels = toPixels(
    {
      x: renderedListener.x + HANDLE_DISTANCE * Math.sin(facingRad),
      z: renderedListener.z + HANDLE_DISTANCE * Math.cos(facingRad),
    },
    canvasSize,
  );

  return (
    <>
      <button
        type="button"
        aria-label={label}
        {...bodyDrag}
        className="absolute z-10 rounded-full border-2 border-theme-surface bg-theme-text-primary shadow-md"
        style={{
          left: pixels.x - LISTENER_TARGET / 2,
          top: pixels.y - LISTENER_TARGET / 2,
          width: LISTENER_TARGET,
          height: LISTENER_TARGET,
          cursor: locked ? 'default' : 'grab',
          touchAction: 'none',
        }}
      />
      {/*
        The facing indicator: a triangle, not a dot, so which way the
        listener faces reads at a glance rather than needing to be inferred
        from a second dot's position relative to the first. `rotate(0deg)`
        points the triangle straight up, which is this stage's "dead ahead"
        (`+z`) — the same convention `facingDeg` itself uses, so the visual
        rotation and the stored angle never need reconciling.
      */}
      <button
        type="button"
        aria-label={handleLabel}
        {...turnDrag}
        className="absolute z-10 flex items-center justify-center"
        style={{
          left: handlePixels.x - 12,
          top: handlePixels.y - 12,
          width: 24,
          height: 24,
          cursor: locked ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        <span
          // `border-bottom` draws the triangle; `text-theme-text-primary`
          // is what `currentColor` reads it from.
          className="text-theme-text-primary"
          style={{
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom: '12px solid currentColor',
            transform: `rotate(${renderedListener.facingDeg}deg)`,
            filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.25))',
          }}
        />
      </button>
    </>
  );
}
