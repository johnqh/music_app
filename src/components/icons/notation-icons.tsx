/**
 * Music-notation icons, drawn rather than typed.
 *
 * These replaced Unicode musical symbols (`𝅝`, `𝅗𝅥`, `𝅘𝅥𝅯`, `𝄫`, …), which cannot be
 * relied on: the note and double-accidental glyphs live in Unicode's
 * Supplementary Multilingual Plane, which most UI fonts do not cover at all, so
 * they render as tofu on a plain system. `𝅗𝅥` is worse still — it is a
 * *two-codepoint* combining sequence, so whether it forms one glyph depends on
 * the shaping engine. And the few that are widely available (`♩`, `♪`) come
 * from a different block with different metrics, so they never lined up with
 * the rest.
 *
 * Every glyph is drawn on the same 24x24 grid with the same construction, so
 * the set is internally consistent in a way a mix of font glyphs cannot be:
 *
 * - Noteheads are ellipses tilted -20°, the angle used by engraving fonts.
 * - Open noteheads are a filled outer ellipse with a *differently tilted*
 *   counter, punched out with `evenodd`. That difference in tilt is what gives
 *   a real notehead its thick/thin contrast; a uniformly stroked ring reads as
 *   a zero, not a note.
 * - Stems sit on the notehead's right edge and are the same length in every
 *   glyph, so the row reads as one family.
 * - Flags repeat one shape at a fixed vertical pitch.
 *
 * Sizing is the caller's job, via `className` — see `ICON_GLYPH_CLASS` in the
 * toolbars, which is what keeps every control the same pixel size.
 */
import type { SVGProps } from 'react';

/**
 * Every icon in both toolbars renders at exactly this size.
 *
 * Sizing lives on the glyph rather than the button because the controls differ
 * — some sit in toggle groups, some are standalone, some carry text — and one
 * class on the icon is what actually guarantees they all come out the same
 * pixel size, which a mix of font glyphs never did.
 *
 * It lives here, beside the icons, rather than in a toolbar: importing it from
 * `EditorToolbar` pulled that module's whole dependency graph into the
 * transport bar and broke the app at start-up.
 */
export const ICON_GLYPH_CLASS = 'size-[18px] shrink-0';

/**
 * The height of every control in an action bar — buttons and selects alike.
 *
 * A bar mixes icon buttons, text buttons and Radix select triggers, and each of
 * those sizes itself from its own content: an 18px glyph with `p-1.5` comes out
 * 30px, `text-sm` with `py-1` comes out 28px, and the row ended up visibly
 * ragged. Padding cannot fix that — it is the *content* that differs — so the
 * height is stated once here and the padding left to centre within it.
 *
 * Lives beside `ICON_GLYPH_CLASS` for the same reason that does: both toolbars
 * and the dashboard need it, and importing it from any one of them drags that
 * module's dependency graph into the others.
 */
export const CONTROL_HEIGHT_CLASS = 'h-8 min-h-8';

/**
 * The ink of every control in an action bar, buttons and selects alike.
 *
 * The library's `ghost` variant draws its text in `text-gray-700` — a muted
 * grey meant for controls of minimal emphasis. Beside a select trigger, whose
 * chosen value reads in the ordinary near-black text colour, that made an
 * action button look like the disabled twin of the control next to it: Triplet
 * read as unavailable while Note length, doing the same job one gap along,
 * read as live.
 *
 * Nothing was actually communicated by the grey, either. A disabled control is
 * already marked by `disabled:opacity-50`, which the variant applies on top of
 * whatever colour this sets — so stating the ordinary text colour here both
 * fixes the false signal and leaves the true one intact.
 *
 * `text-foreground` rather than this app's `text-theme-text-primary`, and the
 * difference matters: the theme token resolves to `var(--color-text-primary)`,
 * which the design package never emits — so it is an undefined variable that
 * merely inherits whatever colour it lands in. `--foreground` is a real token,
 * and it is the one the select trigger beside these buttons already uses, so
 * this matches the control it has to agree with instead of approximating it.
 *
 * Stated with the height, and for the same reason: it is a property of the bar
 * rather than of any one control in it, and both toolbars need it.
 */
export const CONTROL_INK_CLASS = 'text-foreground';

/** An icon-only control: square at the shared height, with the glyph centred. */
export const ICON_CONTROL_CLASS = `${CONTROL_HEIGHT_CLASS} ${CONTROL_INK_CLASS} w-8 shrink-0 inline-flex items-center justify-center p-0 text-sm leading-none`;

/** A control carrying text (or text + glyph) at the shared height. */
export const TEXT_CONTROL_CLASS = `${CONTROL_HEIGHT_CLASS} ${CONTROL_INK_CLASS} inline-flex items-center gap-1 px-2 py-0 text-sm leading-none`;

type GlyphProps = SVGProps<SVGSVGElement>;

/** Shared frame: one grid, one fill rule, no intrinsic size. */
function Glyph({ children, ...props }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

// --- shared note geometry -------------------------------------------------

/** Notehead centre for every stemmed duration, so the row shares one baseline. */
const HEAD_X = 8.6;
const HEAD_Y = 17.4;
/** Right edge of the tilted notehead, which is where a stem attaches. */
const STEM_RIGHT = 12;
const STEM_WIDTH = 1.25;
const STEM_TOP = 3;

/** Filled notehead, tilted like an engraved one. */
function NoteHead() {
  return (
    <ellipse
      cx={HEAD_X}
      cy={HEAD_Y}
      rx={3.6}
      ry={2.55}
      transform={`rotate(-20 ${HEAD_X} ${HEAD_Y})`}
    />
  );
}

function Stem() {
  return (
    <rect x={STEM_RIGHT - STEM_WIDTH} y={STEM_TOP} width={STEM_WIDTH} height={HEAD_Y - STEM_TOP} />
  );
}

/** Vertical pitch between successive flags, tuned so three still clear the notehead. */
const FLAG_PITCH = 3;

/** One flag, hanging from the stem at `y`: a wing that sweeps right and down. */
function Flag({ y }: { y: number }) {
  return (
    <path
      d={`M${STEM_RIGHT} ${y}
          C${STEM_RIGHT + 4.2} ${y + 1.5} ${STEM_RIGHT + 5.7} ${y + 3.6} ${STEM_RIGHT + 4.6} ${y + 5.4}
          C${STEM_RIGHT + 5.1} ${y + 3.9} ${STEM_RIGHT + 3.2} ${y + 2.3} ${STEM_RIGHT} ${y + 2.7}
          Z`}
    />
  );
}

// --- durations ------------------------------------------------------------

/**
 * Semibreve: no stem, so it is centred in the box rather than sharing the
 * stemmed notes' left-hand notehead position — with nothing on the right to
 * balance it, an aligned head would just look adrift.
 */
export function WholeNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M7.1 17.4A4.5 2.8 0 1 0 16.1 17.4A4.5 2.8 0 1 0 7.1 17.4ZM9.31 18.83A2.7 1.25 -32 1 0 13.89 15.97A2.7 1.25 -32 1 0 9.31 18.83Z"
      />
    </Glyph>
  );
}

export function HalfNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M5.22 18.63A3.6 2.55 -20 1 0 11.98 16.17A3.6 2.55 -20 1 0 5.22 18.63ZM6.25 18.26A2.5 1 -20 1 0 10.95 16.54A2.5 1 -20 1 0 6.25 18.26Z"
      />
      <Stem />
    </Glyph>
  );
}

export function QuarterNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <NoteHead />
      <Stem />
    </Glyph>
  );
}

export function EighthNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <NoteHead />
      <Stem />
      <Flag y={STEM_TOP} />
    </Glyph>
  );
}

export function SixteenthNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <NoteHead />
      <Stem />
      <Flag y={STEM_TOP} />
      <Flag y={STEM_TOP + FLAG_PITCH} />
    </Glyph>
  );
}

export function ThirtySecondNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <NoteHead />
      <Stem />
      <Flag y={STEM_TOP} />
      <Flag y={STEM_TOP + FLAG_PITCH} />
      <Flag y={STEM_TOP + FLAG_PITCH * 2} />
    </Glyph>
  );
}

// --- accidentals ----------------------------------------------------------

/**
 * One flat: an upright stem with a teardrop bowl on its lower right. `bowl`
 * scales the bowl horizontally so the doubled form can be narrower — at full
 * width the first bowl runs into the second stem.
 */
function flatAt(x: number, bowl = 1) {
  const w = (n: number) => x + 1.25 + n * bowl;
  return (
    <>
      <rect x={x} y={3.6} width={1.25} height={16} rx={0.4} />
      <path
        d={`M${x + 1.25} 11.6
            C${w(4.15)} 10.2 ${w(5.95)} 13.4 ${w(3.05)} 16.1
            C${w(1.95)} 17.1 ${w(0.75)} 18.1 ${x + 1.25} 18.8
            Z`}
      />
    </>
  );
}

export function FlatIcon(props: GlyphProps) {
  return <Glyph {...props}>{flatAt(9)}</Glyph>;
}

export function DoubleFlatIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      {flatAt(3.9, 0.78)}
      {flatAt(11.6, 0.78)}
    </Glyph>
  );
}

export function NaturalIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={8.2} y={3} width={1.2} height={13.8} />
      <rect x={14.6} y={7.2} width={1.2} height={13.8} />
      {/* Slanted crossbars, kept close to the stems' weight so they do not swamp them. */}
      <path d="M8.2 9.9 L15.8 8.5 L15.8 10.4 L8.2 11.8 Z" />
      <path d="M8.2 14.5 L15.8 13.1 L15.8 15 L8.2 16.4 Z" />
    </Glyph>
  );
}

export function SharpIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={9} y={4.2} width={1.3} height={15.6} />
      <rect x={13.7} y={4.2} width={1.3} height={15.6} />
      <path d="M6.8 10.6 L17.2 8.9 L17.2 11.3 L6.8 13 Z" />
      <path d="M6.8 15 L17.2 13.3 L17.2 15.7 L6.8 17.4 Z" />
    </Glyph>
  );
}

/** Double sharp: the squat X of four wedges, not two sharps. */
export function DoubleSharpIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.8 4.8 L12 9.6 L19.2 4.8 L14.4 12 L19.2 19.2 L12 14.4 L4.8 19.2 L9.6 12 Z" />
    </Glyph>
  );
}

// --- articulation ---------------------------------------------------------

/** Tie: two noteheads joined by a slur, which is what the control does. */
export function TieIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={6.4} cy={16.4} rx={2.9} ry={2.1} transform="rotate(-20 6.4 16.4)" />
      <ellipse cx={17.6} cy={16.4} rx={2.9} ry={2.1} transform="rotate(-20 17.6 16.4)" />
      <path d="M5.2 12.2 C8.2 4.9 15.8 4.9 18.8 12.2 C15.8 7.6 8.2 7.6 5.2 12.2 Z" />
    </Glyph>
  );
}

/**
 * Articulation: a notehead under an accent.
 *
 * The control applies one of several articulations, so the icon shows the
 * category rather than any single mark — an accent over a note is the most
 * legible stand-in at toolbar size.
 */
export function ArticulationIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={12} cy={17.2} rx={3.6} ry={2.55} transform="rotate(-20 12 17.2)" />
      <path d="M5.4 6 L18.6 9.6 L18.6 11.8 L5.4 8.2 Z" />
      <path d="M18.6 9.6 L5.4 13.2 L5.4 11 L18.6 7.4 Z" />
    </Glyph>
  );
}

// --- editing actions ------------------------------------------------------

/** A plus badge, so "insert" actions read as actions and not as duration toggles. */
function PlusBadge() {
  return (
    <>
      <rect x={16.4} y={3.2} width={6.4} height={1.9} rx={0.6} />
      <rect x={18.65} y={0.95} width={1.9} height={6.4} rx={0.6} />
    </>
  );
}

/**
 * Insert note. The plus matters: without it this is just a quarter note, and
 * the duration group two controls to the left already shows one of those.
 */
export function InsertNoteIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <g transform="translate(-0.6 2) scale(0.86)">
        <ellipse
          cx={HEAD_X}
          cy={HEAD_Y}
          rx={3.6}
          ry={2.55}
          transform={`rotate(-20 ${HEAD_X} ${HEAD_Y})`}
        />
        <rect
          x={STEM_RIGHT - STEM_WIDTH}
          y={STEM_TOP}
          width={STEM_WIDTH}
          height={HEAD_Y - STEM_TOP}
        />
      </g>
      <PlusBadge />
    </Glyph>
  );
}

/** Add measure: an empty bar with a plus badge. */
export function AddMeasureIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={3} y={7} width={1.4} height={10} />
      <rect x={14} y={7} width={1.4} height={10} />
      <rect x={3} y={11.3} width={12.4} height={1.2} />
      <PlusBadge />
    </Glyph>
  );
}

/** Delete measure: the same bar, struck through. */
export function DeleteMeasureIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={3} y={7} width={1.4} height={10} />
      <rect x={14} y={7} width={1.4} height={10} />
      <rect x={3} y={11.3} width={12.4} height={1.2} />
      <path
        d="M15 19 L22 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Glyph>
  );
}

/** Dotted: a notehead with the augmentation dot beside it. */
export function DottedIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={9} cy={HEAD_Y} rx={3.4} ry={2.4} transform={`rotate(-20 9 ${HEAD_Y})`} />
      <rect x={11.4} y={4} width={STEM_WIDTH} height={HEAD_Y - 4} />
      <circle cx={16.6} cy={HEAD_Y} r={1.7} />
    </Glyph>
  );
}

/** Triplet: three beamed heads under the numeral that names them. */
export function TripletIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <text
        x={12}
        y={9}
        textAnchor="middle"
        fontSize={9}
        fontStyle="italic"
        fill="currentColor"
        stroke="none"
      >
        3
      </text>
      {[5.5, 12, 18.5].map((cx) => (
        <ellipse key={cx} cx={cx} cy={19} rx={2.3} ry={1.7} />
      ))}
      <rect x={4.5} y={12.5} width={15} height={1.4} />
    </Glyph>
  );
}

/**
 * Insert mode: a note arriving between two that were already there, which is
 * exactly what the mode does to the notes after the caret.
 */
export function InsertModeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={4.6} cy={HEAD_Y} rx={2.6} ry={1.9} />
      <ellipse cx={19.4} cy={HEAD_Y} rx={2.6} ry={1.9} />
      <path
        d="M12 19 L12 6 M8.6 9.4 L12 6 L15.4 9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** Replace mode: a note landing on the one that was already in that place. */
export function ReplaceModeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={12} cy={HEAD_Y} rx={3.4} ry={2.4} />
      <path
        d="M12 12.4 L12 4.5 M8.6 7.9 L12 4.5 L15.4 7.9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/**
 * Chord: three noteheads stacked on one stem — a triad as it is actually
 * engraved, which is also exactly what the toggle produces.
 *
 * Heads sit a third apart (two staff positions) and share the stem, so the
 * glyph reads as one chord rather than three notes that happen to be near each
 * other.
 */
export function ChordIcon(props: GlyphProps) {
  const spacing = 3.4;
  return (
    <Glyph {...props}>
      {[0, 1, 2].map((step) => (
        <ellipse
          key={step}
          cx={HEAD_X}
          cy={HEAD_Y - step * spacing}
          rx={3.4}
          ry={2.4}
          transform={`rotate(-20 ${HEAD_X} ${HEAD_Y - step * spacing})`}
        />
      ))}
      <rect
        x={STEM_RIGHT - STEM_WIDTH}
        y={STEM_TOP}
        width={STEM_WIDTH}
        height={HEAD_Y - 2 * spacing - STEM_TOP}
      />
    </Glyph>
  );
}

/** Insert rest: the quarter-rest zigzag with its bottom curl, plus the badge. */
export function InsertRestIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <g transform="translate(-1.2 1.4) scale(0.88)">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.6 5.6 L14.4 11.2 L9.4 14.2 L13.6 18.2"
        />
        <path d="M13.9 17.7 C10.6 16.1 8.8 17.7 9.8 20.4 C7.4 18.2 7.6 14.4 11.6 15.3 Z" />
      </g>
      <PlusBadge />
    </Glyph>
  );
}

/** Select all: a marquee around the music. */
export function SelectAllIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={3}
        y={5}
        width={18}
        height={14}
        rx={1.6}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeDasharray="3.4 2.6"
      />
      <ellipse cx={9} cy={14.2} rx={2.2} ry={1.6} transform="rotate(-20 9 14.2)" />
      <rect x={10.8} y={8.4} width={0.9} height={5.8} />
      <ellipse cx={15.4} cy={14.2} rx={2.2} ry={1.6} transform="rotate(-20 15.4 14.2)" />
      <rect x={17.2} y={8.4} width={0.9} height={5.8} />
    </Glyph>
  );
}

/** Quantize: a notehead snapping onto a gridline. */
export function QuantizeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={4.2} y={3} width={1.1} height={18} rx={0.4} opacity={0.45} />
      <rect x={11.45} y={3} width={1.1} height={18} rx={0.4} />
      <rect x={18.7} y={3} width={1.1} height={18} rx={0.4} opacity={0.45} />
      <ellipse cx={12} cy={12} rx={3.4} ry={2.4} transform="rotate(-20 12 12)" />
      <path d="M7.4 12 L10.1 9.9 L10.1 14.1 Z" />
    </Glyph>
  );
}

/** Page layout: systems wrapped onto a page. */
export function PageLayoutIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={4}
        y={3}
        width={16}
        height={18}
        rx={1.8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <rect x={7} y={7.4} width={10} height={1.6} rx={0.6} />
      <rect x={7} y={11.2} width={10} height={1.6} rx={0.6} />
      <rect x={7} y={15} width={6.4} height={1.6} rx={0.6} />
    </Glyph>
  );
}

/*
  The three widths of the track-info column, drawn as the sheet they leave:
  the same frame and the same staves, with the column beside them at the
  width the mode gives it. Read left to right they are one picture narrowing.
*/

/** Track info in full: a column wide enough to be written in. */
export function TrackInfoFullIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={3}
        y={4}
        width={18}
        height={16}
        rx={1.8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <rect x={10.6} y={4} width={1.6} height={16} />
      <rect x={5.4} y={8} width={3.4} height={1.6} rx={0.6} />
      <rect x={5.4} y={11.6} width={3.4} height={1.6} rx={0.6} />
      <rect x={14} y={9} width={5} height={1.4} rx={0.6} />
      <rect x={14} y={13.4} width={5} height={1.4} rx={0.6} />
    </Glyph>
  );
}

/** Track info as the icon alone: a column as wide as one mark. */
export function TrackInfoIconIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={3}
        y={4}
        width={18}
        height={16}
        rx={1.8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <rect x={7.6} y={4} width={1.6} height={16} />
      <circle cx={5.9} cy={9.6} r={1} />
      <circle cx={5.9} cy={14.2} r={1} />
      <rect x={11} y={9} width={8} height={1.4} rx={0.6} />
      <rect x={11} y={13.4} width={8} height={1.4} rx={0.6} />
    </Glyph>
  );
}

/** Track info hidden: the sheet, and nothing beside it. */
export function TrackInfoHiddenIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={3}
        y={4}
        width={18}
        height={16}
        rx={1.8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <rect x={6} y={9} width={12} height={1.4} rx={0.6} />
      <rect x={6} y={13.4} width={12} height={1.4} rx={0.6} />
    </Glyph>
  );
}

/** Continuous layout: one line running off both edges. */
export function ContinuousLayoutIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={2.4} y={11.2} width={19.2} height={1.7} rx={0.6} />
      <path d="M6.6 6.6 L2 12 L6.6 17.4 Z" />
      <path d="M17.4 6.6 L22 12 L17.4 17.4 Z" />
    </Glyph>
  );
}

/**
 * Metronome: the trapezoid case with its pendulum rod.
 *
 * Drawn rather than borrowed — no general-purpose icon set has a metronome,
 * and a generic clock or tick would not say "click track".
 */
export function MetronomeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M9.2 3.4 L14.8 3.4 L18.6 20.6 L5.4 20.6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <rect x={6.6} y={16.4} width={10.8} height={1.6} />
      <path d="M15.8 6.6 L10.6 17 L9.1 16.3 L14.3 5.9 Z" />
      <rect x={11.9} y={9.6} width={3.4} height={2.4} rx={0.5} transform="rotate(-24 13.6 10.8)" />
    </Glyph>
  );
}

/**
 * Light/dark theme: one disc, lit on the left and dark on the right.
 *
 * Drawn rather than borrowed because the general sets offer a sun *or* a moon,
 * and either one alone names a destination rather than the choice — this
 * control opens a menu of light, dark and system. It replaced 🌓, which was an
 * emoji: it kept its own colours against the app bar's inverted text, and
 * rendered at whatever size the platform's emoji font felt like.
 */
export function SunMoonIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      {/* The lit half: a filled semicircle with the sun's rays on its side. */}
      <path d="M12 3.6 a8.4 8.4 0 0 0 0 16.8 Z" />
      <path
        d="M12 3.6 a8.4 8.4 0 0 1 0 16.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <g stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
        <path d="M12 1.4 V0.2 M12 23.8 V22.6 M4.1 4.1 L3.2 3.2 M4.1 19.9 L3.2 20.8 M1.4 12 H0.2" />
      </g>
    </Glyph>
  );
}

/**
 * The piano-keyboard toggle: three white keys with two black keys between them.
 *
 * Drawn rather than borrowed because the general sets have no piano. The whites
 * are one outlined frame split by two dividers, and the blacks are filled and
 * straddle those dividers — so each divider only shows *below* its black key,
 * which is how a real keyboard looks from above. The blacks stop two thirds of
 * the way down; a black key as long as the whites reads as a column chart.
 *
 * Everything inherits `currentColor`, so it follows the theme like every other
 * icon here.
 */
const KEY_LEFT = 3;
const KEY_RIGHT = 21;
const KEY_TOP = 5;
const KEY_BOTTOM = 19;
const WHITE_KEY_W = (KEY_RIGHT - KEY_LEFT) / 3;
const BLACK_KEY_W = 3.6;
/** Black keys end two thirds of the way down the whites. */
const BLACK_KEY_BOTTOM = Math.round((KEY_TOP + ((KEY_BOTTOM - KEY_TOP) * 2) / 3) * 100) / 100;
/** The two boundaries between the three whites, where the blacks sit. */
const KEY_DIVIDERS = [KEY_LEFT + WHITE_KEY_W, KEY_LEFT + WHITE_KEY_W * 2];

export function PianoKeysIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect
        x={KEY_LEFT}
        y={KEY_TOP}
        width={KEY_RIGHT - KEY_LEFT}
        height={KEY_BOTTOM - KEY_TOP}
        rx={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d={KEY_DIVIDERS.map((x) => `M${x} ${BLACK_KEY_BOTTOM} V${KEY_BOTTOM}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      {KEY_DIVIDERS.map((x) => (
        <rect
          key={x}
          x={x - BLACK_KEY_W / 2}
          y={KEY_TOP}
          width={BLACK_KEY_W}
          height={BLACK_KEY_BOTTOM - KEY_TOP}
        />
      ))}
    </Glyph>
  );
}

// --- transport navigation -------------------------------------------------
//
// The three of these are one family, built from two parts: a bar that means
// "the end of the road" and a triangle that means "go". Which side the bar sits
// on is the whole message, which is why they are drawn here rather than
// borrowed — the general-purpose sets pair a double triangle for "start" with
// bare chevrons for "step", so the row read as two unrelated ideas and neither
// one said where it would stop.

/** Bar length and thickness, shared so the three icons line up as a set. */
const TRANSPORT_BAR_W = 2.2;
const TRANSPORT_TOP = 5.4;
const TRANSPORT_BOTTOM = 18.6;
const TRANSPORT_H = TRANSPORT_BOTTOM - TRANSPORT_TOP;

/** A triangle spanning `left`..`right`, pointing right (or left when mirrored). */
function transportTriangle(left: number, right: number, pointsRight = true): string {
  const [tip, base] = pointsRight ? [right, left] : [left, right];
  return `M${base} ${TRANSPORT_TOP} L${tip} 12 L${base} ${TRANSPORT_BOTTOM} Z`;
}

/** Go to start: a bar, then two triangles pointing back at it. */
export function GoToStartIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={3.4} y={TRANSPORT_TOP} width={TRANSPORT_BAR_W} height={TRANSPORT_H} rx={0.6} />
      <path d={transportTriangle(6.8, 13.4, false)} />
      <path d={transportTriangle(13.9, 20.5, false)} />
    </Glyph>
  );
}

/** Previous measure: a bar, then one triangle pointing back at it. */
export function PreviousMeasureIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x={4.6} y={TRANSPORT_TOP} width={TRANSPORT_BAR_W} height={TRANSPORT_H} rx={0.6} />
      <path d={transportTriangle(8.6, 18.4, false)} />
    </Glyph>
  );
}

/** Next measure: one triangle, then the bar it runs into. */
export function NextMeasureIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d={transportTriangle(5.6, 15.4)} />
      <rect x={17.2} y={TRANSPORT_TOP} width={TRANSPORT_BAR_W} height={TRANSPORT_H} rx={0.6} />
    </Glyph>
  );
}

/**
 * Solo: headphones, the studio convention for "let me hear only this".
 *
 * Drawn because no general icon set carries one, and the alternatives say the
 * wrong thing — a star means favourite, a speaker means the opposite of solo.
 */
export function SoloIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M4.4 15.4 V12.6 a7.6 7.6 0 0 1 15.2 0 V15.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <rect x={2.8} y={13.6} width={4.4} height={7} rx={2.2} />
      <rect x={16.8} y={13.6} width={4.4} height={7} rx={2.2} />
    </Glyph>
  );
}

/**
 * A phrase mark: two noteheads under one curve.
 *
 * Drawn rather than reused from the tie glyph, which is the same curve joining
 * two notes *of the same pitch* — the two marks look alike and mean different
 * things, so the icons show different pitches to say which is which.
 */
export function SlurIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M6 15c2.5-5 9.5-5 12 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="6" cy="17.5" r="2.2" fill="currentColor" />
      <circle cx="18" cy="17.5" r="2.2" fill="currentColor" />
    </svg>
  );
}

/**
 * A fermata: the arc with its dot, drawn over a notehead.
 *
 * The notehead is what tells it apart from the slur icon above, which is the
 * same arc without one — a slur spans notes, a fermata sits on one.
 */
export function FermataIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 12c2.5-6 13.5-6 16 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="17.5" r="2.6" fill="currentColor" />
    </svg>
  );
}

/**
 * An ornament: the trill's "tr" wave, which is the sign a reader recognises
 * fastest of the four the menu offers.
 */
export function OrnamentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 15c1.6-4 3.4-4 5 0s3.4 4 5 0 3.4-4 5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 9h5M7.5 9V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A crescendo wedge: opening left to right, the way it is written. */
export function CrescendoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 12L20 6M4 12l16 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A diminuendo wedge: the same mark closing instead of opening. */
export function DiminuendoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M20 12L4 6M20 12L4 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * An arpeggio: the wavy vertical line drawn beside a rolled chord, with the
 * noteheads it rolls through.
 */
export function ArpeggioIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M7 20c-2-2 2-4 0-6s2-4 0-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="15" cy="7" r="2.1" fill="currentColor" />
      <circle cx="15" cy="13" r="2.1" fill="currentColor" />
      <circle cx="15" cy="19" r="2.1" fill="currentColor" />
    </svg>
  );
}

/**
 * A broken beam: two beamed pairs with a gap between them, which is what
 * "break the beam here" produces on the page.
 */
export function BeamBreakIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      {/* Two stems, their beam, then a gap, then two more. */}
      <path
        d="M4 18V7M9 18V7M15 18V7M20 18V7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M4 7h5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15 7h5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      {/* The break itself, marked where the beam stops. */}
      <path
        d="M12 4v5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="1.5 1.8"
      />
    </svg>
  );
}

/** An unbeamed pair: two notes drawn with flags instead of a beam. */
export function BeamNoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M7 19V6M17 19V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* A flag on each stem, which is what an unbeamed eighth draws. */}
      <path
        d="M7 6c3 1 4 3 3 5M17 6c3 1 4 3 3 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="19" r="1.9" fill="currentColor" />
      <circle cx="15" cy="19" r="1.9" fill="currentColor" />
    </svg>
  );
}
