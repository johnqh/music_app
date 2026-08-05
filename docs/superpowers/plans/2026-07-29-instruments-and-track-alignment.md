# Instruments and Track/Stave Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 128 General MIDI instruments selectable with icons, name the active instrument on the piano keyboard, and align each track's row in the left panel with that track's stave on the sheet.

**Architecture:** A pure GM data table in `music_lib` (`domain/instruments/gm.ts`) feeds a family-grouped picker and an emoji icon module in `music_app`. Alignment flows one way: `ScoreEditorView` owns the `LayoutPlan` and scroll position, so it computes stave rects for the topmost visible system in **viewport client coordinates** and reports them up through `AppLayout` to `TrackPanel`, which positions rows against its own bounding box. No new store state — this is view geometry.

**Tech Stack:** TypeScript (strict), Zustand 5 + Immer, React 19, Tailwind, `@sudobility/components` (Radix-backed `Select`), Vitest + Testing Library + jsdom, Playwright. Bun for scripts.

**Spec:** `docs/superpowers/specs/2026-07-29-instruments-and-track-alignment-design.md`

## Global Constraints

- Two repos: `/Users/johnhuang/projects/music_lib` and `/Users/johnhuang/projects/music_app`. **Phase 1 lands and publishes before Phase 2 begins.**
- **No `music_types` change.** `Track.midiProgram` stays a required integer 0–127, exactly as the schema already validates. Nothing here makes it nullable.
- **No MIDI export warning.** Every instrument is one of the 128 GM programs, so export is never lossy and a confirm dialog would be unreachable.
- `music_lib` source uses **relative imports with `.js` specifiers**; `music_app` uses the `@/` alias.
- Domain code (`music_lib/src/domain/**`) must not import React, VexFlow, Tone, or browser APIs. `domain/instruments/gm.ts` is a data table and lookups only.
- Every score mutation goes through a `ScoreCommand` via `dispatchCommand`. Instrument changes use the existing `changeTrackPropsCommand`.
- **Playback performance rules hold** (see `CLAUDE.md`): nothing added here may read `positionTick` or `activeNoteIds` at a large component's top level, and nothing may run per animation frame.
- Both repos must pass `bun run verify`; `music_app` must also pass `bun run test:e2e`.
- Commit messages use conventional-commit prefixes and end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

### Existing signatures this plan builds on

```ts
// music_lib/src/domain/commands/structure-commands.ts
export type TrackPropsPatch = Partial<Omit<Track, 'id' | 'measures'>>;
export function changeTrackPropsCommand(trackId: UUID, patch: TrackPropsPatch): ScoreCommand;

// music_lib/src/adapters/tone/instruments.ts
export type InstrumentCategory =
  'piano' | 'electric-piano' | 'strings' | 'bass' | 'synth-lead' | 'drum-kit';
export function resolveInstrumentCategory(
  nameOrProgram: string | number,
  isPercussion: boolean,
): InstrumentCategory;

// music_lib/src/adapters/vexflow/layout.ts
export type MeasureLayout = { measureIndex: number; isFirstInSystem: boolean; box: StaveBox };
export type TrackLayout = { track: Track; measures: MeasureLayout[] };
export type SystemLayout = {
  measureIndices: number[];
  xLeft: number;
  xRight: number;
  gutterTop: number;
  yTop: number;
  yBottom: number;
};
export type LayoutPlan = {
  tracks: Track[];
  trackLayouts: TrackLayout[];
  systems: SystemLayout[];
  totalWidth: number;
  totalHeight: number;
};
```

---

# Phase 1 — GM catalogue (`music_lib`)

All Phase 1 work happens in `/Users/johnhuang/projects/music_lib`.

---

### Task 1: The 128-program catalogue

**Files:**

- Create: `src/domain/instruments/gm.ts`
- Test: `src/domain/instruments/gm.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `GmFamily`, `GmInstrument`, `GM_INSTRUMENTS`, `GM_FAMILY_LABELS`, `GM_FAMILIES`, `gmInstrument(program)`, `gmFamilyOf(program)`, `gmInstrumentsByFamily(family)`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/instruments/gm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  GM_INSTRUMENTS,
  gmFamilyOf,
  gmInstrument,
  gmInstrumentsByFamily,
} from './gm.js';

describe('GM_INSTRUMENTS', () => {
  it('has exactly 128 entries, in program order', () => {
    expect(GM_INSTRUMENTS).toHaveLength(128);
    GM_INSTRUMENTS.forEach((instrument, i) => {
      expect(instrument.program).toBe(i);
    });
  });

  it('gives every entry a non-empty name', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(instrument.name.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(GM_INSTRUMENTS.map((i) => i.name)).size).toBe(128);
  });

  it('anchors on the well-known General MIDI assignments', () => {
    expect(gmInstrument(0)!.name).toBe('Acoustic Grand Piano');
    expect(gmInstrument(24)!.name).toBe('Acoustic Guitar (nylon)');
    expect(gmInstrument(40)!.name).toBe('Violin');
    expect(gmInstrument(56)!.name).toBe('Trumpet');
    expect(gmInstrument(73)!.name).toBe('Flute');
    expect(gmInstrument(127)!.name).toBe('Gunshot');
  });
});

describe('families', () => {
  it('has 16 families of 8', () => {
    expect(GM_FAMILIES).toHaveLength(16);
    for (const family of GM_FAMILIES) {
      expect(gmInstrumentsByFamily(family)).toHaveLength(8);
    }
  });

  it('labels every family', () => {
    for (const family of GM_FAMILIES) {
      expect(GM_FAMILY_LABELS[family].length).toBeGreaterThan(0);
    }
  });

  it('agrees between gmFamilyOf and the table, for all 128', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(gmFamilyOf(instrument.program)).toBe(instrument.family);
    }
  });

  it('assigns the first eight programs to piano and the last eight to sound effects', () => {
    expect(gmFamilyOf(0)).toBe('piano');
    expect(gmFamilyOf(7)).toBe('piano');
    expect(gmFamilyOf(120)).toBe('sound-effects');
    expect(gmFamilyOf(127)).toBe('sound-effects');
  });

  it('returns each family group in program order', () => {
    const guitars = gmInstrumentsByFamily('guitar');
    expect(guitars.map((g) => g.program)).toEqual([24, 25, 26, 27, 28, 29, 30, 31]);
  });
});

describe('gmInstrument', () => {
  it('resolves every valid program', () => {
    for (let program = 0; program < 128; program += 1) {
      expect(gmInstrument(program)).not.toBeNull();
    }
  });

  it('returns null outside 0-127 rather than throwing', () => {
    // Track.midiProgram is schema-validated to 0-127, so this guards against a
    // hand-edited score, not an expected path.
    expect(gmInstrument(-1)).toBeNull();
    expect(gmInstrument(128)).toBeNull();
    expect(gmInstrument(1.5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- gm`
Expected: FAIL — `Cannot find module './gm.js'`

- [ ] **Step 3: Write the catalogue**

Create `src/domain/instruments/gm.ts`:

```ts
/**
 * The General MIDI Level 1 sound set: 128 programs, grouped into 16 families
 * of 8. Pure data and lookups — no Tone, no VexFlow, no store.
 *
 * `Track.midiProgram` is exactly a program number from this table, and
 * `music_types` already validates it to 0-127, so this module never has to
 * defend against a bad value from the schema — only against a hand-edited
 * score, which is why `gmInstrument` returns `null` rather than throwing.
 */

export type GmFamily =
  | 'piano'
  | 'chromatic-percussion'
  | 'organ'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'ensemble'
  | 'brass'
  | 'reed'
  | 'pipe'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-effects'
  | 'ethnic'
  | 'percussive'
  | 'sound-effects';

export type GmInstrument = {
  /** 0-127, matching `Track.midiProgram`. */
  program: number;
  /** The General MIDI name, e.g. "Acoustic Grand Piano". */
  name: string;
  family: GmFamily;
};

/** In program order: family `i` covers programs `i*8 .. i*8+7`. */
export const GM_FAMILIES: readonly GmFamily[] = [
  'piano',
  'chromatic-percussion',
  'organ',
  'guitar',
  'bass',
  'strings',
  'ensemble',
  'brass',
  'reed',
  'pipe',
  'synth-lead',
  'synth-pad',
  'synth-effects',
  'ethnic',
  'percussive',
  'sound-effects',
];

export const GM_FAMILY_LABELS: Record<GmFamily, string> = {
  piano: 'Piano',
  'chromatic-percussion': 'Chromatic Percussion',
  organ: 'Organ',
  guitar: 'Guitar',
  bass: 'Bass',
  strings: 'Strings',
  ensemble: 'Ensemble',
  brass: 'Brass',
  reed: 'Reed',
  pipe: 'Pipe',
  'synth-lead': 'Synth Lead',
  'synth-pad': 'Synth Pad',
  'synth-effects': 'Synth Effects',
  ethnic: 'Ethnic',
  percussive: 'Percussive',
  'sound-effects': 'Sound Effects',
};

/**
 * The 128 names in program order. Families are NOT stored per row: they are a
 * contiguous run of eight, so `gmFamilyOf` derives them and the table cannot
 * drift out of sync with `GM_FAMILIES`.
 */
const GM_NAMES: readonly string[] = [
  // 0-7 Piano
  'Acoustic Grand Piano',
  'Bright Acoustic Piano',
  'Electric Grand Piano',
  'Honky-tonk Piano',
  'Electric Piano 1',
  'Electric Piano 2',
  'Harpsichord',
  'Clavinet',
  // 8-15 Chromatic Percussion
  'Celesta',
  'Glockenspiel',
  'Music Box',
  'Vibraphone',
  'Marimba',
  'Xylophone',
  'Tubular Bells',
  'Dulcimer',
  // 16-23 Organ
  'Drawbar Organ',
  'Percussive Organ',
  'Rock Organ',
  'Church Organ',
  'Reed Organ',
  'Accordion',
  'Harmonica',
  'Tango Accordion',
  // 24-31 Guitar
  'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)',
  'Electric Guitar (jazz)',
  'Electric Guitar (clean)',
  'Electric Guitar (muted)',
  'Overdriven Guitar',
  'Distortion Guitar',
  'Guitar Harmonics',
  // 32-39 Bass
  'Acoustic Bass',
  'Electric Bass (finger)',
  'Electric Bass (pick)',
  'Fretless Bass',
  'Slap Bass 1',
  'Slap Bass 2',
  'Synth Bass 1',
  'Synth Bass 2',
  // 40-47 Strings
  'Violin',
  'Viola',
  'Cello',
  'Contrabass',
  'Tremolo Strings',
  'Pizzicato Strings',
  'Orchestral Harp',
  'Timpani',
  // 48-55 Ensemble
  'String Ensemble 1',
  'String Ensemble 2',
  'Synth Strings 1',
  'Synth Strings 2',
  'Choir Aahs',
  'Voice Oohs',
  'Synth Voice',
  'Orchestra Hit',
  // 56-63 Brass
  'Trumpet',
  'Trombone',
  'Tuba',
  'Muted Trumpet',
  'French Horn',
  'Brass Section',
  'Synth Brass 1',
  'Synth Brass 2',
  // 64-71 Reed
  'Soprano Sax',
  'Alto Sax',
  'Tenor Sax',
  'Baritone Sax',
  'Oboe',
  'English Horn',
  'Bassoon',
  'Clarinet',
  // 72-79 Pipe
  'Piccolo',
  'Flute',
  'Recorder',
  'Pan Flute',
  'Blown Bottle',
  'Shakuhachi',
  'Whistle',
  'Ocarina',
  // 80-87 Synth Lead
  'Lead 1 (square)',
  'Lead 2 (sawtooth)',
  'Lead 3 (calliope)',
  'Lead 4 (chiff)',
  'Lead 5 (charang)',
  'Lead 6 (voice)',
  'Lead 7 (fifths)',
  'Lead 8 (bass + lead)',
  // 88-95 Synth Pad
  'Pad 1 (new age)',
  'Pad 2 (warm)',
  'Pad 3 (polysynth)',
  'Pad 4 (choir)',
  'Pad 5 (bowed)',
  'Pad 6 (metallic)',
  'Pad 7 (halo)',
  'Pad 8 (sweep)',
  // 96-103 Synth Effects
  'FX 1 (rain)',
  'FX 2 (soundtrack)',
  'FX 3 (crystal)',
  'FX 4 (atmosphere)',
  'FX 5 (brightness)',
  'FX 6 (goblins)',
  'FX 7 (echoes)',
  'FX 8 (sci-fi)',
  // 104-111 Ethnic
  'Sitar',
  'Banjo',
  'Shamisen',
  'Koto',
  'Kalimba',
  'Bagpipe',
  'Fiddle',
  'Shanai',
  // 112-119 Percussive
  'Tinkle Bell',
  'Agogo',
  'Steel Drums',
  'Woodblock',
  'Taiko Drum',
  'Melodic Tom',
  'Synth Drum',
  'Reverse Cymbal',
  // 120-127 Sound Effects
  'Guitar Fret Noise',
  'Breath Noise',
  'Seashore',
  'Bird Tweet',
  'Telephone Ring',
  'Helicopter',
  'Applause',
  'Gunshot',
];

/** The family a program belongs to. Arithmetic, because families are runs of eight. */
export function gmFamilyOf(program: number): GmFamily {
  return GM_FAMILIES[Math.floor(program / 8)];
}

export const GM_INSTRUMENTS: readonly GmInstrument[] = GM_NAMES.map((name, program) => ({
  program,
  name,
  family: gmFamilyOf(program),
}));

/** `null` for anything that is not an integer in 0-127. */
export function gmInstrument(program: number): GmInstrument | null {
  if (!Number.isInteger(program) || program < 0 || program > 127) return null;
  return GM_INSTRUMENTS[program];
}

/** The eight programs of one family, in program order — what the picker groups by. */
export function gmInstrumentsByFamily(family: GmFamily): readonly GmInstrument[] {
  return GM_INSTRUMENTS.filter((instrument) => instrument.family === family);
}
```

- [ ] **Step 4: Export from the package root**

`src/index.ts` uses `export * from` per module. Find the domain export block:

```bash
grep -n "domain/pitch" src/index.ts
```

Add alongside it:

```ts
// domain/instruments
export * from './domain/instruments/gm.js';
```

- [ ] **Step 5: Run the test**

Run: `bun run test -- gm`
Expected: PASS (12 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(domain): add the 128-program General MIDI catalogue

Names in program order plus 16 families of 8. Families are derived
arithmetically rather than stored per row, so the table cannot drift out of
sync with the family list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Map every GM family to a synth voice

**Files:**

- Modify: `src/adapters/tone/instruments.ts:55-70` (`categoryForProgram`)
- Modify: `src/adapters/tone/instruments.test.ts`

**Interfaces:**

- Consumes: `GmFamily`, `gmFamilyOf` (Task 1).
- Produces: no new API — `resolveInstrumentCategory` keeps its signature; only which category a program resolves to changes.

**Why:** `categoryForProgram` currently distinguishes five program ranges and returns `'piano'` for everything else — its own comment says "there is no dedicated voice for those families yet". With 128 programs selectable, that means 122 of them sound like a piano. Six voices cannot represent sixteen families, but mapping each family to its _nearest_ voice is honest where defaulting to piano is not. Real per-family timbres are explicitly out of scope (spec §1.2).

- [ ] **Step 1: Write the failing test**

Append to `src/adapters/tone/instruments.test.ts`:

```ts
describe('categoryForProgram covers every GM family', () => {
  it('never falls back to piano for a non-piano family', () => {
    // The regression this guards: 122 of 128 programs used to resolve to
    // 'piano', so picking Trumpet played a piano.
    const pianoFamilyPrograms = new Set(
      GM_INSTRUMENTS.filter((i) => i.family === 'piano').map((i) => i.program),
    );
    for (const instrument of GM_INSTRUMENTS) {
      const category = resolveInstrumentCategory(instrument.program, false);
      if (!pianoFamilyPrograms.has(instrument.program)) {
        expect(category, `program ${instrument.program} (${instrument.name})`).not.toBe('piano');
      }
    }
  });

  it('resolves a category for all 128 programs', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(resolveInstrumentCategory(instrument.program, false)).toBeTruthy();
    }
  });

  it('keeps the categories the app already shipped', () => {
    expect(resolveInstrumentCategory(0, false)).toBe('piano'); // Acoustic Grand
    expect(resolveInstrumentCategory(4, false)).toBe('electric-piano'); // E.Piano 1
    expect(resolveInstrumentCategory(32, false)).toBe('bass'); // Acoustic Bass
    expect(resolveInstrumentCategory(48, false)).toBe('strings'); // String Ensemble 1
    expect(resolveInstrumentCategory(80, false)).toBe('synth-lead'); // Lead 1
  });

  it('maps the newly-covered families to their nearest voice', () => {
    expect(resolveInstrumentCategory(56, false)).toBe('synth-lead'); // Trumpet -> sustained
    expect(resolveInstrumentCategory(73, false)).toBe('synth-lead'); // Flute -> sustained
    expect(resolveInstrumentCategory(24, false)).toBe('electric-piano'); // Guitar -> plucked
    expect(resolveInstrumentCategory(112, false)).toBe('drum-kit'); // Percussive
    expect(resolveInstrumentCategory(8, false)).toBe('electric-piano'); // Celesta -> struck
  });

  it('still lets a percussion clef win over any program', () => {
    expect(resolveInstrumentCategory(0, true)).toBe('drum-kit');
    expect(resolveInstrumentCategory(56, true)).toBe('drum-kit');
  });

  it('falls back for a program outside the GM range rather than throwing', () => {
    expect(() => resolveInstrumentCategory(999, false)).not.toThrow();
    expect(resolveInstrumentCategory(999, false)).toBe('piano');
  });
});
```

Add to the file's imports:

```ts
import { GM_INSTRUMENTS } from '../../domain/instruments/gm.js';
```

Check `resolveInstrumentCategory` is already imported; if not, add it to the existing `./instruments.js` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- instruments`
Expected: FAIL — brass, reed, pipe, guitar, organ, ensemble, ethnic, synth-pad, synth-effects, chromatic-percussion and sound-effects all still resolve to `'piano'`.

- [ ] **Step 3: Rewrite `categoryForProgram`**

Replace the whole function in `src/adapters/tone/instruments.ts`:

```ts
/**
 * The synth voice for a GM family. Six voices cannot represent sixteen
 * families, so each family maps to its nearest available one — plucked and
 * struck sounds to `electric-piano`, sustained winds and pads to
 * `synth-lead`, tuned percussion to `drum-kit`.
 *
 * This is deliberately "nearest of six", not "correct". Every family used to
 * fall through to `'piano'`, which meant 122 of the 128 programs played a
 * piano once the full catalogue became selectable. Real per-family timbres
 * need ~10 new Tone voices and are tracked separately (see the instruments
 * spec, §1.2).
 */
const FAMILY_CATEGORY: Record<GmFamily, InstrumentCategory> = {
  piano: 'piano',
  'chromatic-percussion': 'electric-piano', // struck and bright
  organ: 'synth-lead', // sustained
  guitar: 'electric-piano', // plucked
  bass: 'bass',
  strings: 'strings',
  ensemble: 'strings',
  brass: 'synth-lead', // sustained
  reed: 'synth-lead', // sustained
  pipe: 'synth-lead', // sustained
  'synth-lead': 'synth-lead',
  'synth-pad': 'strings', // slow, sustained pad
  'synth-effects': 'synth-lead',
  ethnic: 'electric-piano', // mostly plucked
  percussive: 'drum-kit',
  'sound-effects': 'synth-lead',
};

/** Category for a General MIDI program number (0-indexed GM1 sound set); `'piano'` for anything outside 0-127. */
function categoryForProgram(program: number): InstrumentCategory {
  const instrument = gmInstrument(program);
  if (!instrument) return 'piano';
  // Electric Piano 1/2 are in the piano family but have their own voice.
  if (program === 4 || program === 5) return 'electric-piano';
  return FAMILY_CATEGORY[instrument.family];
}
```

Add the import at the top of the file:

```ts
import { gmInstrument } from '../../domain/instruments/gm.js';
import type { GmFamily } from '../../domain/instruments/gm.js';
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- instruments`
Expected: PASS

- [ ] **Step 5: Full verify**

Run: `bun run verify`
Expected: PASS. If a pre-existing test asserted that some program resolves to `'piano'`, update it — that was the bug, not the contract.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(tone): map every GM family to a voice instead of defaulting to piano

categoryForProgram distinguished five program ranges and returned 'piano' for
the rest, which its own comment acknowledged. Harmless while only six
instruments were selectable; with the full 128-program catalogue it meant
picking Trumpet played a piano.

Each of the 16 families now maps to its nearest of the six voices. That is
"nearest", not "correct" -- real per-family timbres need new Tone voices and
are tracked separately.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Publish `music_lib`

**Files:**

- Modify: `package.json` (version)

- [ ] **Step 1: Full verify**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 2: Bump the minor version**

Additive only — no breaking changes in Phase 1. Read the current version and bump the minor:

```bash
grep '"version"' package.json
```

Edit `package.json` to the next minor (e.g. `0.4.2` → `0.5.0`).

- [ ] **Step 3: Commit and push**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: release 0.5.0 (General MIDI catalogue)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 4: Wait for the publish**

CI publishes on push to main (~3-4 min).

```bash
until [ "$(npm view @sudobility/music_lib version 2>/dev/null)" = "0.5.0" ]; do sleep 30; done
echo published
```

Use whatever version you actually set. Do not start Phase 2 before this returns.

---

# Phase 2 — Picker and icons (`music_app`)

All Phase 2+ work happens in `/Users/johnhuang/projects/music_app`. **Start by upgrading:**

```bash
bun add @sudobility/music_lib@^0.5.0
```

---

### Task 4: Instrument icons

**Files:**

- Create: `src/features/instruments/instrument-icon.tsx`
- Test: `src/features/instruments/instrument-icon.test.tsx`

**Interfaces:**

- Consumes: `GM_INSTRUMENTS`, `GmFamily`, `gmFamilyOf`, `gmInstrument` (Task 1).
- Produces: `instrumentEmoji(program: number): string`, `InstrumentIcon(props: { program: number; className?: string })`.

- [ ] **Step 1: Write the failing test**

Create `src/features/instruments/instrument-icon.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GM_INSTRUMENTS, gmFamilyOf } from '@sudobility/music_lib';
import { InstrumentIcon, instrumentEmoji } from '@/features/instruments/instrument-icon';

describe('instrumentEmoji', () => {
  it('gives every one of the 128 programs a non-empty glyph', () => {
    for (const instrument of GM_INSTRUMENTS) {
      expect(instrumentEmoji(instrument.program).length).toBeGreaterThan(0);
    }
  });

  it('uses the hand-picked glyph for common instruments', () => {
    expect(instrumentEmoji(0)).toBe('🎹'); // Acoustic Grand Piano
    expect(instrumentEmoji(24)).toBe('🎸'); // Acoustic Guitar (nylon)
    expect(instrumentEmoji(40)).toBe('🎻'); // Violin
    expect(instrumentEmoji(56)).toBe('🎺'); // Trumpet
    expect(instrumentEmoji(65)).toBe('🎷'); // Alto Sax
    expect(instrumentEmoji(73)).toBe('🪈'); // Flute
  });

  it('falls back to the family glyph for an instrument with no hand-picked one', () => {
    // Every member of a family shares a glyph unless hand-picked, so two
    // un-picked members of the same family must agree.
    const sameFamily = GM_INSTRUMENTS.filter((i) => i.family === 'synth-effects');
    const glyphs = new Set(sameFamily.map((i) => instrumentEmoji(i.program)));
    expect(glyphs.size).toBe(1);
  });

  it('falls back rather than returning empty for a program outside the range', () => {
    expect(instrumentEmoji(-1).length).toBeGreaterThan(0);
    expect(instrumentEmoji(999).length).toBeGreaterThan(0);
  });

  it('gives every family a glyph', () => {
    const families = new Set(GM_INSTRUMENTS.map((i) => gmFamilyOf(i.program)));
    for (const family of families) {
      const member = GM_INSTRUMENTS.find((i) => i.family === family)!;
      expect(instrumentEmoji(member.program).length).toBeGreaterThan(0);
    }
  });
});

describe('InstrumentIcon', () => {
  it('renders the glyph', () => {
    const { container } = render(<InstrumentIcon program={40} />);
    expect(container.textContent).toBe('🎻');
  });

  it('is hidden from assistive tech, since the name is always beside it', () => {
    const { container } = render(<InstrumentIcon program={40} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes through a className', () => {
    const { container } = render(<InstrumentIcon program={40} className="text-lg" />);
    expect(container.firstElementChild).toHaveClass('text-lg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- instrument-icon`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the icon module**

Create `src/features/instruments/instrument-icon.tsx`:

```tsx
/**
 * Emoji icons for General MIDI instruments.
 *
 * Emoji rather than an SVG set, deliberately: this app's chrome is already
 * emoji throughout (`◀◀ ▶ ■ 💾 ↶ ↷ 🌓 ⚙ ✕ ▴ ▾`), so a bespoke instrument SVG
 * set would be the inconsistent choice, and ~36 hand-drawn glyphs is an
 * illustration project with ongoing upkeep for a label-sized affordance. The
 * trade, recorded so it is not mistaken for an oversight: emoji render
 * differently across platforms and cannot be recoloured to the theme.
 */
import { gmFamilyOf, gmInstrument } from '@sudobility/music_lib';
import type { GmFamily } from '@sudobility/music_lib';

/** Hand-picked glyphs for the instruments people actually reach for. */
const PROGRAM_EMOJI: Record<number, string> = {
  0: '🎹', // Acoustic Grand Piano
  1: '🎹', // Bright Acoustic Piano
  4: '🎹', // Electric Piano 1
  6: '🎹', // Harpsichord
  11: '🎵', // Vibraphone
  16: '🪗', // Drawbar Organ
  19: '🎛️', // Church Organ
  21: '🪗', // Accordion
  22: '🎶', // Harmonica
  24: '🎸', // Acoustic Guitar (nylon)
  25: '🎸', // Acoustic Guitar (steel)
  27: '🎸', // Electric Guitar (clean)
  30: '🎸', // Distortion Guitar
  32: '🎸', // Acoustic Bass
  33: '🎸', // Electric Bass (finger)
  40: '🎻', // Violin
  42: '🎻', // Cello
  46: '🎼', // Orchestral Harp
  48: '🎻', // String Ensemble 1
  52: '🎤', // Choir Aahs
  56: '🎺', // Trumpet
  57: '🎺', // Trombone
  58: '🎺', // Tuba
  64: '🎷', // Soprano Sax
  65: '🎷', // Alto Sax
  66: '🎷', // Tenor Sax
  71: '🎶', // Clarinet
  72: '🪈', // Piccolo
  73: '🪈', // Flute
  74: '🪈', // Recorder
  104: '🪕', // Sitar
  105: '🪕', // Banjo
  114: '🥁', // Steel Drums
  116: '🥁', // Taiko Drum
};

/** Every family has one, so all 128 programs resolve to something. */
const FAMILY_EMOJI: Record<GmFamily, string> = {
  piano: '🎹',
  'chromatic-percussion': '🎵',
  organ: '🪗',
  guitar: '🎸',
  bass: '🎸',
  strings: '🎻',
  ensemble: '🎼',
  brass: '🎺',
  reed: '🎷',
  pipe: '🪈',
  'synth-lead': '🎛️',
  'synth-pad': '🎛️',
  'synth-effects': '✨',
  ethnic: '🪕',
  percussive: '🥁',
  'sound-effects': '🔊',
};

/** The hand-picked glyph for `program`, else its family's. */
export function instrumentEmoji(program: number): string {
  const picked = PROGRAM_EMOJI[program];
  if (picked) return picked;
  // An out-of-range program has no family; fall back rather than render blank.
  return gmInstrument(program) ? FAMILY_EMOJI[gmFamilyOf(program)] : FAMILY_EMOJI.piano;
}

export type InstrumentIconProps = { program: number; className?: string };

/**
 * Decorative: the instrument's name is always rendered beside it, so this is
 * `aria-hidden` and screen readers get the name rather than an emoji reading.
 */
export function InstrumentIcon({ program, className }: InstrumentIconProps) {
  return (
    <span aria-hidden="true" className={className}>
      {instrumentEmoji(program)}
    </span>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- instrument-icon`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(instruments): emoji icons for all 128 GM programs

Hand-picked glyphs for the common instruments, family fallback for the rest.
Emoji rather than SVG because this app's chrome is already emoji throughout;
the trade (platform-dependent rendering, no theming) is documented in the
module.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Instrument picker in the track panel

**Files:**

- Modify: `src/components/layout/TrackPanel.tsx`
- Modify: `src/components/layout/TrackPanel.test.tsx`

**Interfaces:**

- Consumes: `InstrumentIcon` (Task 4), `GM_FAMILIES`, `GM_FAMILY_LABELS`, `gmInstrumentsByFamily`, `gmInstrument` (Task 1), `changeTrackPropsCommand`.
- Produces: no exported API.

- [ ] **Step 1: Write the failing test**

Append to `src/components/layout/TrackPanel.test.tsx`:

```tsx
describe('instrument picker', () => {
  it('shows the active instrument name and its icon', () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => {
      store.getState().dispatchCommand(
        changeTrackPropsCommand(score.tracks[0].id, {
          midiProgram: 40,
          instrumentName: 'Violin',
        }),
      );
    });

    render(<TrackPanel store={store} />);

    expect(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`)).toHaveTextContent(
      'Violin',
    );
  });

  it('lists every GM family as a group', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();
    const score = store.getState().score!;

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));

    for (const label of Object.values(GM_FAMILY_LABELS)) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it('offers all 128 programs', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();
    const score = store.getState().score!;

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));

    expect(await screen.findAllByRole('option')).toHaveLength(128);
  });

  it('choosing an instrument sets both midiProgram and instrumentName', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();
    const score = store.getState().score!;

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));
    await user.click(await screen.findByRole('option', { name: /Trumpet/ }));

    const track = store.getState().score!.tracks[0];
    expect(track.midiProgram).toBe(56);
    // The two fields could drift before, since instrumentName was free text.
    expect(track.instrumentName).toBe('Trumpet');
  });

  it('the instrument change is undoable, like any score edit', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();
    const score = store.getState().score!;
    const before = score.tracks[0].midiProgram;

    await user.click(screen.getByLabelText(`Instrument: ${score.tracks[0].name}`));
    await user.click(await screen.findByRole('option', { name: /Trumpet/ }));
    act(() => store.getState().undo());

    expect(store.getState().score!.tracks[0].midiProgram).toBe(before);
  });
});
```

Add to the file's imports:

```tsx
import { GM_FAMILY_LABELS, changeTrackPropsCommand } from '@sudobility/music_lib';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- TrackPanel`
Expected: FAIL — there is no instrument control, only a static `<p>`.

- [ ] **Step 3: Widen the row's patch type**

In `TrackPanel.tsx`, the `TrackRow` prop currently reads:

```tsx
  onPatch: (
    patch: Partial<Pick<Track, 'name' | 'instrumentName' | 'volume' | 'pan' | 'muted' | 'solo'>>,
  ) => void;
```

Add `midiProgram`:

```tsx
  onPatch: (
    patch: Partial<
      Pick<Track, 'name' | 'instrumentName' | 'midiProgram' | 'volume' | 'pan' | 'muted' | 'solo'>
    >,
  ) => void;
```

`changeTrackPropsCommand`'s own `TrackPropsPatch` is `Partial<Omit<Track, 'id' | 'measures'>>`, so it already accepts this — only the row's narrowed prop needed widening.

- [ ] **Step 4: Replace the static instrument line with the picker**

Find the read-only line:

```tsx
<p className="text-xs text-theme-text-secondary">{track.instrumentName}</p>
```

Replace it with:

```tsx
{
  /* Setting both fields together: `instrumentName` is free text and could
          previously drift from `midiProgram`. The catalogue name is now the
          single source of both. */
}
<div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
  <InstrumentIcon program={track.midiProgram} className="text-sm" />
  <Select
    value={String(track.midiProgram)}
    onValueChange={(value: string) => {
      const program = Number(value);
      const instrument = gmInstrument(program);
      if (!instrument) return;
      onPatch({ midiProgram: program, instrumentName: instrument.name });
    }}
  >
    <SelectTrigger
      aria-label={`Instrument: ${track.name}`}
      className="h-auto w-full px-1 py-0.5 text-xs"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {GM_FAMILIES.map((family) => (
        <SelectGroup key={family}>
          <SelectLabel>{GM_FAMILY_LABELS[family]}</SelectLabel>
          {gmInstrumentsByFamily(family).map((instrument) => (
            <SelectItem key={instrument.program} value={String(instrument.program)}>
              {instrument.name}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </SelectContent>
  </Select>
</div>;
```

`stopPropagation` on the wrapper matches what the mute/solo row already does, so opening the picker doesn't also select the track.

Add the imports:

```tsx
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  gmInstrument,
  gmInstrumentsByFamily,
} from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
```

Add `SelectGroup` and `SelectLabel` to the existing `@sudobility/components` import. Both are exported — verified with:

```bash
node -e "const m=require('./node_modules/@sudobility/components/dist/index.js'); console.log(Object.keys(m).filter(k=>k.startsWith('Select')).join(' '))"
# Select SelectContent SelectField SelectGroup SelectItem SelectLabel ... SelectTrigger SelectValue
```

- [ ] **Step 5: Run the tests**

Run: `bun run test -- TrackPanel`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(track-panel): pick any of the 128 GM instruments

Replaces the read-only instrument line with an icon plus a Select grouped by
the 16 GM families. Choosing one sets midiProgram and instrumentName together,
so the two can no longer drift.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 3 — Keyboard header

---

### Task 6: Name the active track's instrument on the keyboard

**Files:**

- Modify: `src/features/piano-keyboard/PianoKeyboardView.tsx`
- Modify: `src/features/piano-keyboard/PianoKeyboardView.test.tsx`

**Interfaces:**

- Consumes: `InstrumentIcon` (Task 4), `gmInstrument` (Task 1).
- Produces: no exported API.

- [ ] **Step 1: Write the failing test**

Append to `src/features/piano-keyboard/PianoKeyboardView.test.tsx`:

```tsx
describe('header names the active instrument', () => {
  it('shows the active track instrument, not the literal "Piano"', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => {
      store.getState().dispatchCommand(
        changeTrackPropsCommand(score.tracks[1].id, {
          midiProgram: 56,
          instrumentName: 'Trumpet',
        }),
      );
      store.getState().setActiveTrack(score.tracks[1].id);
    });

    const { container } = render(<PianoKeyboardView store={store} />);

    expect(container.textContent).toContain('Trumpet');
  });

  it('follows the active track', () => {
    const store = makeStore(twoTrackScore());
    const score = store.getState().score!;
    act(() => {
      store.getState().dispatchCommand(
        changeTrackPropsCommand(score.tracks[0].id, {
          midiProgram: 40,
          instrumentName: 'Violin',
        }),
      );
      store.getState().dispatchCommand(
        changeTrackPropsCommand(score.tracks[1].id, {
          midiProgram: 56,
          instrumentName: 'Trumpet',
        }),
      );
      store.getState().setActiveTrack(score.tracks[0].id);
    });
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(container.textContent).toContain('Violin');

    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    expect(container.textContent).toContain('Trumpet');
    expect(container.textContent).not.toContain('Violin');
  });

  it('falls back to "Keyboard" with no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(container.textContent).toContain('Keyboard');
  });
});
```

Add `changeTrackPropsCommand` to the file's `@sudobility/music_lib` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- PianoKeyboardView`
Expected: FAIL — the header renders `Piano — <track name>`.

- [ ] **Step 3: Show the instrument**

In `PianoKeyboardView.tsx`, replace the `trackName` derivation:

```tsx
const trackName = activeTrackId && score ? (findTrack(score, activeTrackId)?.name ?? null) : null;
```

with the active track itself, so both its name and its program are available:

```tsx
const activeTrack = activeTrackId && score ? findTrack(score, activeTrackId) : null;
/**
 * The instrument, not the literal word "Piano": the keyboard is a view of
 * whichever track is active, and that track is frequently not a piano.
 * Falls back to the track's own name when the program has no catalogue
 * entry (a hand-edited score), and to "Keyboard" when there is no score.
 */
const headerLabel = activeTrack
  ? (gmInstrument(activeTrack.midiProgram)?.name ?? activeTrack.name)
  : 'Keyboard';
```

Then replace the header's text:

```tsx
<span className="text-xs font-medium text-theme-text-primary">
  {/* Names the track on screen: the keyboard itself carries no track
            identity, so without this there is no way to tell which hand it is. */}
  Piano{trackName ? ` — ${trackName}` : ''}
</span>
```

with:

```tsx
{
  activeTrack && <InstrumentIcon program={activeTrack.midiProgram} className="text-sm" />;
}
<span className="text-xs font-medium text-theme-text-primary">
  {/* The keyboard carries no track identity of its own, so the header is
            the only thing telling you which part you are looking at. */}
  {headerLabel}
  {activeTrack ? ` — ${activeTrack.name}` : ''}
</span>;
```

Add the imports:

```tsx
import { gmInstrument } from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- PianoKeyboardView`
Expected: PASS. The existing "names the active track and follows it when it changes" test still passes, since the track name is still shown after the instrument.

- [ ] **Step 5: Full verify**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(piano-keyboard): name the active track's instrument in the header

It said "Piano" regardless of what the active track actually was.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Phase 4 — Track rows aligned to staves

---

### Task 7: Stave-rect geometry

**Files:**

- Create: `src/features/score-editor/stave-layout.ts`
- Test: `src/features/score-editor/stave-layout.test.ts`

**Interfaces:**

- Consumes: `LayoutPlan` (music_lib).
- Produces: `StaveRect = { trackId: string; top: number; height: number }`, `staveRectsForViewport(plan, zoom, scrollTop, boxTop): StaveRect[]`.

- [ ] **Step 1: Write the failing test**

Create `src/features/score-editor/stave-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LayoutPlan } from '@sudobility/music_lib';
import { staveRectsForViewport } from '@/features/score-editor/stave-layout';

/**
 * Two tracks, two systems. Only the fields the function reads, so the
 * expectations stay legible: system 0 staves at y 28 and 148, system 1 at
 * y 268 and 388, each 100 tall.
 */
function plan(): LayoutPlan {
  return {
    tracks: [{ id: 't0' }, { id: 't1' }],
    systems: [
      { measureIndices: [0, 1], xLeft: 10, xRight: 410, gutterTop: 10, yTop: 28, yBottom: 248 },
      { measureIndices: [2, 3], xLeft: 10, xRight: 410, gutterTop: 250, yTop: 268, yBottom: 488 },
    ],
    trackLayouts: [
      {
        track: { id: 't0' },
        measures: [
          {
            measureIndex: 0,
            isFirstInSystem: true,
            box: { x: 10, y: 28, width: 200, height: 100 },
          },
          {
            measureIndex: 2,
            isFirstInSystem: true,
            box: { x: 10, y: 268, width: 200, height: 100 },
          },
        ],
      },
      {
        track: { id: 't1' },
        measures: [
          {
            measureIndex: 0,
            isFirstInSystem: true,
            box: { x: 10, y: 148, width: 200, height: 100 },
          },
          {
            measureIndex: 2,
            isFirstInSystem: true,
            box: { x: 10, y: 388, width: 200, height: 100 },
          },
        ],
      },
    ],
    totalWidth: 420,
    totalHeight: 520,
  } as unknown as LayoutPlan;
}

describe('staveRectsForViewport', () => {
  it('returns one rect per track', () => {
    const rects = staveRectsForViewport(plan(), 1, 0, 0);
    expect(rects.map((r) => r.trackId)).toEqual(['t0', 't1']);
  });

  it('uses the topmost visible system', () => {
    // Scrolled to 0: system 0, staves at 28 and 148.
    expect(staveRectsForViewport(plan(), 1, 0, 0).map((r) => r.top)).toEqual([28, 148]);
    // Scrolled past system 0: system 1, staves at 268 and 388, minus the scroll.
    expect(staveRectsForViewport(plan(), 1, 260, 0).map((r) => r.top)).toEqual([8, 128]);
  });

  it('scales by zoom', () => {
    const rects = staveRectsForViewport(plan(), 2, 0, 0);
    expect(rects[0].top).toBe(56); // 28 * 2
    expect(rects[0].height).toBe(200); // 100 * 2
  });

  it('offsets into client coordinates by the box top', () => {
    const rects = staveRectsForViewport(plan(), 1, 0, 100);
    expect(rects[0].top).toBe(128); // 28 + 100
  });

  it('subtracts the scroll position', () => {
    const rects = staveRectsForViewport(plan(), 1, 20, 0);
    expect(rects[0].top).toBe(8); // 28 - 20
  });

  it('returns a positive height per rect', () => {
    for (const rect of staveRectsForViewport(plan(), 1, 0, 0)) {
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('returns empty for a plan with no systems', () => {
    const empty = {
      tracks: [],
      systems: [],
      trackLayouts: [],
      totalWidth: 0,
      totalHeight: 0,
    } as unknown as LayoutPlan;
    expect(staveRectsForViewport(empty, 1, 0, 0)).toEqual([]);
  });

  it('falls back to the last system when scrolled past everything', () => {
    // Rather than returning nothing, which would blank the track panel.
    const rects = staveRectsForViewport(plan(), 1, 100_000, 0);
    expect(rects).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- stave-layout`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/score-editor/stave-layout.ts`:

```ts
/**
 * Where each track's stave sits on screen, for the topmost visible system.
 *
 * Pure over `LayoutPlan` — no DOM, no store — so the coordinate maths is
 * unit-testable. `ScoreEditorView` is the only thing that holds both the
 * layout plan and the live scroll position, so it is the only thing that can
 * compute this; the track panel consumes it.
 *
 * Results are in **viewport client coordinates**, because the consumer is a
 * sibling column with its own origin and its own top offset (the editor
 * toolbar sits above the staves but not above the track panel). Each side
 * converts against its own bounding box and neither needs to know the other's
 * layout.
 */
import type { LayoutPlan } from '@sudobility/music_lib';

export type StaveRect = {
  trackId: string;
  /** Client-space top edge of this track's stave. */
  top: number;
  /** Zoom-scaled stave height. */
  height: number;
};

export function staveRectsForViewport(
  plan: LayoutPlan,
  zoom: number,
  scrollTop: number,
  boxTop: number,
): StaveRect[] {
  if (plan.systems.length === 0) return [];

  // The first system whose bottom is still below the viewport top — i.e. the
  // one showing at the top of the scrollport. Scrolled past the end,
  // `findIndex` returns -1 and we fall back to the last system rather than
  // returning nothing, which would blank the panel at the bottom of a long
  // score.
  const scrollLogical = scrollTop / zoom;
  const found = plan.systems.findIndex((system) => system.yBottom >= scrollLogical);
  const system = found === -1 ? plan.systems[plan.systems.length - 1] : plan.systems[found];

  const measureIndex = system.measureIndices[0];
  const rects: StaveRect[] = [];

  for (const trackLayout of plan.trackLayouts) {
    const placement = trackLayout.measures.find((m) => m.measureIndex === measureIndex);
    if (!placement) continue;
    rects.push({
      trackId: trackLayout.track.id,
      top: placement.box.y * zoom - scrollTop + boxTop,
      height: placement.box.height * zoom,
    });
  }

  return rects;
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- stave-layout`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): compute stave rects for the topmost visible system

Client coordinates, so the track panel can position against its own box
without either side knowing the other's layout.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Report the rects and align the rows

**Files:**

- Modify: `src/features/score-editor/ScoreEditorView.tsx`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/TrackPanel.tsx`
- Modify: `src/components/layout/TrackPanel.test.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`

**Interfaces:**

- Consumes: `StaveRect`, `staveRectsForViewport` (Task 7).
- Produces: `ScoreEditorViewProps.onStaveLayout?: (rects: readonly StaveRect[]) => void`, `TrackPanelProps.staveRects?: readonly StaveRect[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/layout/TrackPanel.test.tsx`:

```tsx
describe('stave alignment', () => {
  function rectsFor(store: EditorStoreApi) {
    return store.getState().score!.tracks.map((track, i) => ({
      trackId: track.id,
      top: 40 + i * 120,
      height: 100,
    }));
  }

  it('positions each row at its reported top and height', () => {
    const store = makeStore();
    const rects = rectsFor(store);
    const { container } = render(<TrackPanel store={store} staveRects={rects} />);

    const row = container.querySelector<HTMLElement>(
      `[data-testid="track-row-${rects[0].trackId}"]`,
    )!;
    expect(row.style.position).toBe('absolute');
    expect(row.style.top).toBe(`${rects[0].top}px`);
    expect(row.style.height).toBe('100px');
  });

  it('gives the second track the second stave position', () => {
    const store = makeStore();
    const rects = rectsFor(store);
    const { container } = render(<TrackPanel store={store} staveRects={rects} />);

    const row = container.querySelector<HTMLElement>(
      `[data-testid="track-row-${rects[1].trackId}"]`,
    )!;
    expect(row.style.top).toBe(`${rects[1].top}px`);
  });

  it('clips row content, so a short stave cannot break alignment', () => {
    const store = makeStore();
    const rects = rectsFor(store);
    const { container } = render(<TrackPanel store={store} staveRects={rects} />);

    const row = container.querySelector<HTMLElement>(
      `[data-testid="track-row-${rects[0].trackId}"]`,
    )!;
    expect(row.style.overflow).toBe('hidden');
  });

  it('falls back to stacked rows when no rects are reported', () => {
    const store = makeStore();
    const { container } = render(<TrackPanel store={store} />);

    const row = container.querySelector<HTMLElement>(
      `[data-testid="track-row-${store.getState().score!.tracks[0].id}"]`,
    )!;
    expect(row.style.position).not.toBe('absolute');
  });

  it('ignores a rect for a track that no longer exists', () => {
    const store = makeStore();
    const rects = [{ trackId: 'deleted-track', top: 10, height: 100 }];
    expect(() => render(<TrackPanel store={store} staveRects={rects} />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- TrackPanel`
Expected: FAIL — `TrackPanel` has no `staveRects` prop.

- [ ] **Step 3: Report from the score editor**

In `ScoreEditorView.tsx`, add the prop:

```tsx
export type ScoreEditorViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Stave rects for the topmost visible system, in viewport client
   * coordinates — how the track panel aligns its rows to the staves. Called on
   * layout change and on the existing rAF-throttled scroll path, never per
   * frame.
   */
  onStaveLayout?: (rects: readonly StaveRect[]) => void;
};
```

Destructure it with a no-op default, then add an effect and fold a call into the scroll path. Add after the existing `draw` callback:

```tsx
const reportStaveLayout = useCallback(() => {
  const box = scrollBoxRef.current;
  if (!box || !layoutPlan) return;
  onStaveLayout(
    staveRectsForViewport(layoutPlan, zoom, box.scrollTop, box.getBoundingClientRect().top),
  );
}, [layoutPlan, zoom, onStaveLayout]);

// Layout-driven: a new plan, zoom or width moves every stave.
useEffect(() => {
  reportStaveLayout();
}, [reportStaveLayout]);
```

Then call it from the existing throttled scroll frame — find `handleScroll` and add the call beside `draw()`:

```tsx
scrollRafIdRef.current = requestAnimationFrame(() => {
  scrollFrameScheduledRef.current = false;
  scrollRafIdRef.current = null;
  draw();
  reportStaveLayout();
});
```

Add `reportStaveLayout` to `handleScroll`'s dependency array.

Imports:

```tsx
import { staveRectsForViewport } from '@/features/score-editor/stave-layout';
import type { StaveRect } from '@/features/score-editor/stave-layout';
```

- [ ] **Step 4: Thread through AppLayout**

In `AppLayout.tsx`, hold the rects and pass them both ways:

```tsx
/**
 * Stave geometry reported by the notation view, so the track panel can line
 * its rows up with the staves. Component state, not store state: this is
 * view-layer geometry and the store's rule is that such geometry stays out
 * of it.
 */
const [staveRects, setStaveRects] = useState<readonly StaveRect[]>([]);
```

```tsx
<TrackPanel store={store} staveRects={staveRects} />
```

```tsx
<ScoreEditorView store={store} onStaveLayout={setStaveRects} />
```

Import the type:

```tsx
import type { StaveRect } from '@/features/score-editor/stave-layout';
```

- [ ] **Step 5: Position the rows**

In `TrackPanel.tsx`, add the prop:

```tsx
export type TrackPanelProps = {
  store?: EditorStoreApi;
  /**
   * Stave rects from the notation view, in client coordinates. When present,
   * rows are absolutely positioned to line up with their staves; when absent
   * (no score, or before the first layout) rows stack normally.
   */
  staveRects?: readonly StaveRect[];
};
```

Build a lookup and stop the list scrolling itself when aligning:

```tsx
const rectByTrackId = useMemo(
  () => new Map((staveRects ?? []).map((rect) => [rect.trackId, rect])),
  [staveRects],
);
const aligned = rectByTrackId.size > 0;
```

The rects are in client coordinates, so the panel converts to its own box:

```tsx
const listRef = useRef<HTMLDivElement | null>(null);
const [listTop, setListTop] = useState(0);
useLayoutEffect(() => {
  const el = listRef.current;
  if (el) setListTop(el.getBoundingClientRect().top);
}, [aligned, staveRects]);
```

Pass each row its rect, and give the list container `relative` when aligned:

```tsx
<TrackRow
  /* ...existing props... */
  rect={rectByTrackId.get(track.id) ?? null}
  listTop={listTop}
/>
```

In `TrackRow`, accept them and apply:

```tsx
  rect: { top: number; height: number } | null;
  listTop: number;
```

```tsx
      style={
        rect
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              // Client -> panel-local.
              top: rect.top - listTop,
              height: rect.height,
              // Clipped so a short stave can never push the row out of
              // alignment; hover and the active row lift instead (below).
              overflow: 'hidden',
            }
          : undefined
      }
```

Add the lift, so clipped controls stay reachable. Append to the row's `className`:

```tsx
        rect && 'hover:z-10 hover:!h-auto hover:overflow-visible hover:shadow-lg',
        rect && active && 'z-10 !h-auto overflow-visible',
```

The `!h-auto` override is deliberate: the height is an inline style, so only an important utility can win. Hovering breaks alignment for that one row on purpose — every other row stays put, and it snaps back when the pointer leaves.

Imports: `useLayoutEffect`, `useMemo`, `useRef`, `useState` from React, and:

```tsx
import type { StaveRect } from '@/features/score-editor/stave-layout';
```

- [ ] **Step 6: Run the tests**

Run: `bun run test -- TrackPanel AppLayout ScoreEditorView`
Expected: PASS. If a `TrackPanel` test asserted the list scrolls (`overflow-y-auto`), update it: the panel mirrors one system now and no longer scrolls independently.

- [ ] **Step 7: Full verify**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(track-panel): align track rows with their staves on the sheet

ScoreEditorView reports stave rects for the topmost visible system in client
coordinates; AppLayout holds them; TrackPanel positions each row to match.
View geometry, so it stays out of the store.

Rows clip, and hover or the active track lifts one above its neighbours to
reach the controls a short stave hides -- alignment for every other row is
never compromised.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: E2E and docs

**Files:**

- Modify: `e2e/acceptance.spec.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/parity-checklist.md`

- [ ] **Step 1: Add e2e coverage**

Append a test to `e2e/acceptance.spec.ts`'s describe block, or create `e2e/instruments.spec.ts`:

```ts
test('picks an instrument and the keyboard header follows', async ({ page }) => {
  const getErrors = collectPageErrors(page);

  await gotoDashboard(page);
  await createNewProject(page, 'Instruments Check');
  await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
  await waitForNotation(page);

  // The picker is labelled per track; take the first one.
  const picker = page.getByLabel(/^Instrument: /).first();
  await picker.click();
  await page.getByRole('option', { name: /^Trumpet$/ }).click();

  // The keyboard header names the active track's instrument.
  await expect(page.getByRole('img', { name: /Piano keyboard/ })).toBeVisible();
  await expect(page.locator('text=Trumpet').first()).toBeVisible();

  expect(getErrors()).toEqual([]);
});
```

- [ ] **Step 2: Run e2e**

Kill anything on 5173/8023 first, then:

```bash
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null; bun run test:e2e
```

Expected: PASS.

- [ ] **Step 3: Update the docs**

`CLAUDE.md` — add to Gotchas:

```markdown
- **Instruments are the 128 General MIDI programs** (`gm.ts` in music_lib). `Track.midiProgram` is the identity; `instrumentName` is set from the catalogue alongside it so the two cannot drift. Icons are emoji (`instrument-icon.tsx`) to match the app's existing emoji chrome. Six Tone voices cover sixteen GM families, so each family maps to its _nearest_ voice — a trumpet does not yet sound like a trumpet, and real per-family timbres are separate work.
- **The track panel mirrors the sheet.** `ScoreEditorView` reports stave rects for the topmost visible system in client coordinates (`stave-layout.ts`), `AppLayout` holds them in component state (view geometry never goes in the store), and `TrackPanel` positions rows to match. Rows clip; hover and the active row lift above their neighbours to reach hidden controls. Reported on the existing rAF-throttled scroll path — do not move it onto a per-frame path.
```

`docs/parity-checklist.md` — append:

```markdown
## Instruments and track alignment (2026-07-29)

| Feature                                             | Tests                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 128-program General MIDI catalogue                  | music_lib `src/domain/instruments/gm.test.ts`                                                    |
| Every GM family maps to a synth voice               | music_lib `src/adapters/tone/instruments.test.ts` ("categoryForProgram covers every GM family")  |
| Instrument icons for all 128 programs               | `src/features/instruments/instrument-icon.test.tsx`                                              |
| Instrument picker, grouped by family                | `src/components/layout/TrackPanel.test.tsx` ("instrument picker"); e2e `e2e/instruments.spec.ts` |
| Picker sets midiProgram and instrumentName together | `TrackPanel.test.tsx` ("choosing an instrument sets both midiProgram and instrumentName")        |
| Keyboard header names the active instrument         | `src/features/piano-keyboard/PianoKeyboardView.test.tsx` ("header names the active instrument")  |
| Stave-rect geometry for the topmost visible system  | `src/features/score-editor/stave-layout.test.ts`                                                 |
| Track rows aligned to their staves                  | `TrackPanel.test.tsx` ("stave alignment")                                                        |
```

- [ ] **Step 4: Final verify and commit**

```bash
bun run verify
git add -A
git commit -m "$(cat <<'EOF'
test(e2e): cover instrument selection; document instruments and alignment

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

| Spec section                                             | Task                      |
| -------------------------------------------------------- | ------------------------- |
| §1 GM catalogue, families, lookups                       | 1                         |
| §1.1 Family → synth voice mapping                        | 2                         |
| §1.2 Per-family voices out of scope                      | 2 (documented, not built) |
| §2.1 Emoji icons, hand-picked + family fallback          | 4                         |
| §2.2 Track picker, sets both fields                      | 5                         |
| §2.3 Generation panel unchanged                          | — (no task, deliberately) |
| §3 Keyboard header names the instrument                  | 6                         |
| §4.1–4.2 Topmost visible system, client coords, contract | 7, 8                      |
| §4.3 Clipping rows, hover/active lift, fallback          | 8                         |
| §4.4 Update rate on scroll + layout only                 | 8                         |
| §5 Testing                                               | every task; e2e in 9      |
| §6 Sequencing (publish between phases)                   | 3                         |
