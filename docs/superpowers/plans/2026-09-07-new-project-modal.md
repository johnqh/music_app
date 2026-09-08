# New Project Modal, Merged Import, and the macOS File Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web dashboard's "New Project" + "Generate Score" + five import buttons with one New Project modal carrying a "Generate for me" toggle and one Import select, mirror both in `music_app_rn`, and make the macOS File menu's New / Open / Save / Save As actually work.

**Architecture:** A blank score built from an instrumentation is stated once, in `music_lib`, beside the generating builder it shares a draft type with — so one form state feeds both and the toggle only chooses which builder runs. The modal emits a discriminated `NewProjectSubmission` rather than a request, which is what lets the same form back a server project on two dashboards and a local document from the macOS File menu. The menu itself keeps the existing two-hop AppKit → notification → `RCTEventEmitter` bridge; only the command list grows.

**Tech Stack:** TypeScript (strict), React 19 + Vite + Tailwind + `@sudobility/components` (web), React Native 0.7x + `@sudobility/components-rn` + NativeWind (native), Zustand, Vitest + Testing Library (web and RN logic), Jest + react-native preset (RN components), Playwright (web e2e), Objective-C + AppKit storyboard (macOS menu).

**Spec:** `docs/superpowers/specs/2026-09-07-new-project-modal-design.md` — read it alongside this plan; every task argues from a section of it.

## Global Constraints

Every task's requirements implicitly include this section.

- **NEVER commit or push.** `music_app/CLAUDE.md`: "Git policy — never auto-commit or auto-push. Leave your work in the working tree." This overrides the writing-plans default of a commit per task. Each task therefore ends with a **verification** step, not a commit. The same rule applies in every sibling repo.
- **No feature branches.** Stay on the current branch (`main`).
- **No business logic in `music_app` or `music_app_rn`.** Score maths, commands, adapters and store slices belong in `music_lib` / `music_types`. That is why Tasks 1–2 come first.
- **Every modal is `FormModal`.** No bare `Dialog`. Any dialog whose footer has a Cancel must set `closeAriaLabel` to something other than "Cancel" (`t('common.closeDialog')`), or two controls share one accessible name.
- **A string with no key is invisible to every parity test there is.** No literal English in JSX, `aria-label`, `accessibilityLabel` or `placeholder`. Grep for `aria-label={'`, ``aria-label={` `` and `ariaLabel: '` before adding a control.
- **Every new key goes in `en` _and_ `zh`, with real Chinese.** `locale-parity.test.ts` fails when a `zh` string contains no CJK — English copied across as a placeholder passes key parity and ships untranslated.
- **A key both apps carry must have identical English.** `music_app_rn/src/i18n/cross-app-parity.test.ts` enforces it. The exact strings are in the table under Task 6 and are reused verbatim in Task 15.
- **`bun`, not `npm`/`yarn`,** in every repo.
- **Test-first.** Write the failing test, run it, watch it fail for the right reason, then implement.
- **Verifying by sabotage.** After a test passes, break the implementation line it covers and confirm that test — and only that test — fails. A test that passes against broken code is not a test.
- **RN test runner split is by extension**: `*.test.ts` → vitest (`bun run test:unit`), `*.test.tsx` → jest (`bun run test:components`). There is nothing to configure; put the file where its runner is.

---

## File Structure

**`music_types`**

- Modify: `src/domain/generation/replacement-region.ts` — `emptyScoreForRequest` carries `midiProgram`.
- Modify: `src/domain/generation/replacement-region.test.ts` — pins it.

**`music_lib`**

- Modify: `src/services/generation/request.ts` — `NewProjectDraft`, `buildNewProjectScore`, `canBuildNewProjectScore`, `NewProjectSubmission`.
- Modify: `src/services/generation/request.test.ts` — pins them.

**`music_app`**

- Create: `src/features/projects/NewProjectDialog.tsx`, `src/features/projects/NewProjectDialog.test.tsx`.
- Delete: `src/features/generation/GenerateScoreDialog.tsx`, `src/features/generation/GenerateScoreDialog.test.tsx`.
- Modify: `src/features/projects/DashboardPage.tsx`, `src/features/projects/DashboardPage.test.tsx`.
- Modify: `public/locales/en/app.json`, `public/locales/zh/app.json`.
- Modify: `e2e/helpers.ts`, `e2e/docs.spec.ts`, `e2e/credits.spec.ts`, `e2e/acceptance.spec.ts`, `e2e/midi-roundtrip.spec.ts`, `e2e/mod-import.spec.ts`, `e2e/musicxml-export.spec.ts`.

**`music_app_rn`**

- Create: `src/features/generation/ScoreSetupFields.tsx` (form body + `useScoreSetupDraft`).
- Create: `src/features/projects/NewProjectSheet.tsx`, `src/features/projects/NewProjectSheet.test.tsx`.
- Create: `src/features/documents/MenuFileCommands.tsx`.
- Modify: `src/features/generation/GenerateScoreSheet.tsx` (renders the extracted body).
- Modify: `src/features/documents/ImportButtons.tsx` (four buttons → one Select).
- Modify: `src/screens/DashboardScreen.tsx` (New Project + Import).
- Modify: `src/documents/document-storage.ts` (`saveDocumentAs`), `src/documents/document-storage.test.ts`.
- Modify: `src/documents/DocumentsContext.tsx` (`onDocumentChanged`).
- Modify: `src/app/menu-commands.ts`, `src/app/App.tsx`.
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/zh.json`.
- Modify: `macos/music_app_rn-macOS/AppDelegate.mm`, `macos/music_app_rn-macOS/Base.lproj/Main.storyboard`.

---

### Task 1: `emptyScoreForRequest` carries the instrument (music_types)

Spec §1.2. `createTrack` defaults `midiProgram` to 0, so every generating project's placeholder is all pianos.

**Files:**

- Modify: `/Users/johnhuang/projects/music_types/src/domain/generation/replacement-region.ts:153-166`
- Test: `/Users/johnhuang/projects/music_types/src/domain/generation/replacement-region.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: no signature change. `emptyScoreForRequest(request: GenerateScoreRequest): Score` now sets `midiProgram` on each track from `request.tracks[i].midiProgram`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/generation/replacement-region.test.ts`:

```ts
describe('emptyScoreForRequest', () => {
  it("keeps each track's instrument, so a placeholder is not four pianos", () => {
    // `createTrack` defaults midiProgram to 0. Dropping it here made every
    // generating project's placeholder an all-piano score whatever was asked
    // for — invisible, because the job's result overwrites it minutes later.
    const score = emptyScoreForRequest({
      prompt: 'A quartet',
      durationMeasures: 4,
      tracks: [
        { name: 'Violin I', instrumentName: 'Violin', midiProgram: 40, clef: 'treble' },
        { name: 'Cello', instrumentName: 'Cello', midiProgram: 42, clef: 'bass' },
      ],
    });

    expect(score.tracks.map((t) => t.midiProgram)).toEqual([40, 42]);
    expect(score.tracks.map((t) => t.clef)).toEqual(['treble', 'bass']);
  });
});
```

Add `emptyScoreForRequest` to that file's existing import from `./replacement-region.js` if it is not already there.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/johnhuang/projects/music_types && bun run test -- replacement-region
```

Expected: FAIL — `expected [ 0, 0 ] to deeply equal [ 40, 42 ]`. If it fails on anything else, stop and read the error; a missing import is not the failure this test is for.

- [ ] **Step 3: Pass the program through**

In `src/domain/generation/replacement-region.ts`, inside `emptyScoreForRequest`:

```ts
    tracks: request.tracks.map((t) => ({
      name: t.name,
      instrumentName: t.instrumentName,
      midiProgram: t.midiProgram,
      clef: t.clef,
    })),
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/johnhuang/projects/music_types && bun run test -- replacement-region
```

Expected: PASS.

- [ ] **Step 5: Verify by sabotage**

Change `midiProgram: t.midiProgram` to `midiProgram: 0`, re-run, confirm **only** the new test fails, then put it back.

- [ ] **Step 6: Verify the package**

```bash
cd /Users/johnhuang/projects/music_types && bun run verify
```

Expected: typecheck, lint, full test suite and build all pass. Leave the change in the working tree — do not commit.

---

### Task 2: `buildNewProjectScore` (music_lib)

Spec §1.1. The blank half of the same draft, stated once for both apps.

**Files:**

- Modify: `/Users/johnhuang/projects/music_lib/src/services/generation/request.ts`
- Test: `/Users/johnhuang/projects/music_lib/src/services/generation/request.test.ts`

**Interfaces:**

- Consumes: `generateScoreTrackForInstrumentValue(value: string): GenerateScoreRequestTrack` and `parseOptionalPositiveTempo`, both already in this file; `createEmptyScore` from `@sudobility/music_types`.
- Produces, for Tasks 4, 5, 9 and 14:

```ts
export type NewProjectDraft = {
  title?: string;
  durationMeasures: number;
  instrumentValues: readonly string[];
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  tempoText?: string;
};
export function buildNewProjectScore(draft: NewProjectDraft): Score | null;
export function canBuildNewProjectScore(draft: NewProjectDraft): boolean;
export type NewProjectSubmission =
  | { kind: 'generate'; request: GenerateScoreRequest }
  | { kind: 'blank'; title: string; score: Score };
```

- [ ] **Step 1: Write the failing tests**

Append to `src/services/generation/request.test.ts`:

```ts
describe('buildNewProjectScore', () => {
  const base = {
    durationMeasures: 8,
    instrumentValues: ['40', '42'],
  };

  it('builds the ensemble that was chosen, with its programs', () => {
    // Through `generateScoreTrackForInstrumentValue`, which is what carries
    // midiProgram — a String Quartet that came back as four pianos is the
    // failure this exists to prevent.
    const score = buildNewProjectScore(base);
    expect(score?.tracks.map((t) => t.midiProgram)).toEqual([40, 42]);
    expect(score?.tracks.map((t) => t.clef)).toEqual(['bass', 'bass']);
  });

  it('builds the number of bars asked for, on every track', () => {
    const score = buildNewProjectScore({ ...base, durationMeasures: 12 });
    expect(score?.tracks.map((t) => t.measures.length)).toEqual([12, 12]);
  });

  it('needs no prompt — that is the whole difference from a generation', () => {
    expect(canBuildNewProjectScore(base)).toBe(true);
    expect(canBuildGenerateScoreRequest({ ...base, prompt: '' })).toBe(false);
  });

  it('titles the score, falling back to Untitled', () => {
    expect(buildNewProjectScore({ ...base, title: '  Wedding March  ' })?.metadata.title).toBe(
      'Wedding March',
    );
    expect(buildNewProjectScore(base)?.metadata.title).toBe('Untitled');
  });

  it('carries the meter and key into every measure', () => {
    const score = buildNewProjectScore({
      ...base,
      timeSignature: { numerator: 3, denominator: 4 },
      keySignature: { fifths: -3, mode: 'minor' },
    });
    const first = score?.tracks[0]?.measures[0];
    expect(first?.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(first?.keySignature).toEqual({ fifths: -3, mode: 'minor' });
  });

  it('takes a blank tempo as "no tempo", and a bad one as a refusal', () => {
    // The same rule the generating builder applies, so the two modes cannot
    // disagree about what a form is allowed to submit.
    expect(buildNewProjectScore({ ...base, tempoText: '' })?.tempoMap[0]?.bpm).toBe(120);
    expect(buildNewProjectScore({ ...base, tempoText: '90' })?.tempoMap[0]?.bpm).toBe(90);
    expect(buildNewProjectScore({ ...base, tempoText: 'fast' })).toBeNull();
    expect(buildNewProjectScore({ ...base, tempoText: '0' })).toBeNull();
  });

  it('refuses a form it could not make a score from', () => {
    expect(buildNewProjectScore({ ...base, durationMeasures: 0 })).toBeNull();
    expect(buildNewProjectScore({ ...base, durationMeasures: 2.5 })).toBeNull();
    expect(buildNewProjectScore({ ...base, instrumentValues: [] })).toBeNull();
  });

  it('accepts a generation draft unchanged, because one form feeds both', () => {
    // `GenerateScoreRequestDraft` is assignable to `NewProjectDraft`. If this
    // stops compiling, the two have been allowed to drift and the toggle can
    // no longer be a toggle.
    const draft: GenerateScoreRequestDraft = { ...base, prompt: 'A waltz', style: 'waltz' };
    expect(buildNewProjectScore(draft)).not.toBeNull();
  });
});
```

Add `buildNewProjectScore`, `canBuildNewProjectScore` and the `GenerateScoreRequestDraft` type to that file's import from `./request.js`.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/johnhuang/projects/music_lib && bun run test -- request
```

Expected: FAIL to compile — `buildNewProjectScore` is not exported.

- [ ] **Step 3: Implement**

In `src/services/generation/request.ts`, add `createEmptyScore` to the existing `@sudobility/music_types` import, then append after `buildGenerateScoreRequest`:

```ts
/**
 * The half of a New Project draft that does not involve the model.
 *
 * `GenerateScoreRequestDraft` is structurally assignable to this — it is this
 * plus `prompt`, `style`, `mood` and `complexity` — which is what lets one form
 * state feed both builders and the Generate-for-me toggle decide only which one
 * runs. Two draft types would be two shapes to keep in step for no gain.
 */
export type NewProjectDraft = {
  title?: string;
  durationMeasures: number;
  instrumentValues: readonly string[];
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  tempoText?: string;
};

/**
 * What a New Project form asked for.
 *
 * A discriminated result rather than a request, because the same form backs a
 * server project on two dashboards and a *local document* from the macOS File
 * menu. The form decides what was asked for; the caller decides where it lands.
 */
export type NewProjectSubmission =
  | { kind: 'generate'; request: GenerateScoreRequest }
  | { kind: 'blank'; title: string; score: Score };

/**
 * The blank score an instrumentation implies.
 *
 * Validated exactly as `buildGenerateScoreRequest` is, minus the prompt — a
 * positive whole number of bars, at least one instrument, and a tempo that is
 * blank or positive — so the two modes of one form disable Create by one rule.
 *
 * Tracks come from `generateScoreTrackForInstrumentValue`, which carries
 * `midiProgram` as well as the name and clef. Building them from the name alone
 * is how a String Quartet comes back as four pianos; see
 * `emptyScoreForRequest`, which had exactly that bug.
 */
export function buildNewProjectScore(draft: NewProjectDraft): Score | null {
  const tempo = parseOptionalPositiveTempo(draft.tempoText);
  if (
    !Number.isInteger(draft.durationMeasures) ||
    draft.durationMeasures <= 0 ||
    draft.instrumentValues.length === 0 ||
    tempo === null
  ) {
    return null;
  }

  return createEmptyScore({
    title: draft.title?.trim() || 'Untitled',
    measures: draft.durationMeasures,
    tracks: draft.instrumentValues.map(generateScoreTrackForInstrumentValue),
    ...(draft.timeSignature ? { timeSignature: draft.timeSignature } : {}),
    ...(draft.keySignature ? { keySignature: draft.keySignature } : {}),
    ...(tempo === undefined ? {} : { tempo }),
  });
}

export function canBuildNewProjectScore(draft: NewProjectDraft): boolean {
  return buildNewProjectScore(draft) !== null;
}
```

- [ ] **Step 4: Run them and watch them pass**

```bash
cd /Users/johnhuang/projects/music_lib && bun run test -- request
```

Expected: PASS, all eight.

- [ ] **Step 5: Verify by sabotage**

Change `tracks: draft.instrumentValues.map(generateScoreTrackForInstrumentValue)` to
`tracks: draft.instrumentValues.map(v => ({ name: v, instrumentName: v, clef: 'treble' as const }))`.
Re-run: "builds the ensemble that was chosen" must fail on the programs. Put it back.

- [ ] **Step 6: Verify the package**

```bash
cd /Users/johnhuang/projects/music_lib && bun run verify
```

Leave in the working tree.

---

### Task 3: Publish the libraries into both apps

Nothing downstream typechecks until this is done. Spec §1.3.

**Files:** none edited — this is a build and copy.

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: `buildNewProjectScore`, `canBuildNewProjectScore`, `NewProjectDraft`, `NewProjectSubmission` resolvable from `@sudobility/music_lib` in both apps.

- [ ] **Step 1: Clean-build both packages**

```bash
cd /Users/johnhuang/projects/music_types && bun run clean && bun run build
cd /Users/johnhuang/projects/music_lib  && bun run clean && bun run build
```

`clean` is not optional: `bun run build` does not empty `dist`, so a file deleted from `src` lingers in the copy you are about to rsync.

- [ ] **Step 2: Rsync into both apps**

```bash
for app in music_app music_app_rn; do
  for pkg in music_types music_lib; do
    rsync -a --delete \
      "/Users/johnhuang/projects/$pkg/dist/" \
      "/Users/johnhuang/projects/$app/node_modules/@sudobility/$pkg/dist/"
  done
done
rm -rf /Users/johnhuang/projects/music_app/node_modules/.vite
```

Deleting `.vite` is what makes the copy take effect. Vite serves its pre-bundled dependency cache otherwise, and the browser runs the old code while the file on disk is right — this has cost two full debugging cycles before.

- [ ] **Step 3: Prove the new symbol resolves in both apps**

```bash
cd /Users/johnhuang/projects/music_app && \
  node -e "import('@sudobility/music_lib').then(m => console.log(typeof m.buildNewProjectScore))"
cd /Users/johnhuang/projects/music_app_rn && \
  grep -c "buildNewProjectScore" node_modules/@sudobility/music_lib/dist/services/generation/request.d.ts
```

Expected: `function`, then a count of at least 1. If either fails, the rsync did not land — check the path exists before re-running.

- [ ] **Step 4: Note the release requirement**

Both packages must be **published before either app ships**: a consumer pins whatever npm serves at that moment, and an rsynced `node_modules` hides that it has not been. Do not publish as part of this plan — say so in the final report.

> **Re-run Task 3 after any `bun add` / `bun remove` in either app.** That reinstalls `node_modules` from the registry and silently replaces everything rsynced in.

---

### Task 4: The web New Project modal

Spec §2.

**Files:**

- Create: `/Users/johnhuang/projects/music_app/src/features/projects/NewProjectDialog.tsx`
- Create: `/Users/johnhuang/projects/music_app/src/features/projects/NewProjectDialog.test.tsx`
- Delete: `src/features/generation/GenerateScoreDialog.tsx`, `src/features/generation/GenerateScoreDialog.test.tsx`
- Modify: `public/locales/en/app.json`, `public/locales/zh/app.json`

**Interfaces:**

- Consumes: `buildNewProjectScore`, `canBuildNewProjectScore`, `NewProjectSubmission` (Task 2); `buildGenerateScoreRequest`, `canBuildGenerateScoreRequest`, `withGenerationVariant` (existing).
- Produces, for Task 5:

```tsx
export type NewProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (submission: NewProjectSubmission) => void;
  submitting?: boolean;
};
export function NewProjectDialog(props: NewProjectDialogProps): JSX.Element;
```

- [ ] **Step 1: Move the file, then add the keys**

```bash
cd /Users/johnhuang/projects/music_app
git mv src/features/generation/GenerateScoreDialog.tsx src/features/projects/NewProjectDialog.tsx
git mv src/features/generation/GenerateScoreDialog.test.tsx src/features/projects/NewProjectDialog.test.tsx
```

(`git mv` only stages a rename in the index; it does not commit.)

Add to `public/locales/en/app.json` a new top-level `newProject` block, keys sorted as its neighbours are:

```json
"newProject": {
  "title": "New Project",
  "generateForMe": "Generate for me",
  "generateForMeHint": "Let AI write the music. Off, you get an empty score with these instruments.",
  "untitled": "Untitled Project"
}
```

and to `public/locales/zh/app.json`:

```json
"newProject": {
  "title": "新建项目",
  "generateForMe": "由 AI 生成",
  "generateForMeHint": "让 AI 谱写音乐。关闭时，你会得到一份使用这些乐器的空白乐谱。",
  "untitled": "未命名项目"
}
```

- [ ] **Step 2: Write the failing tests**

Replace the top of `src/features/projects/NewProjectDialog.test.tsx` — the import, the `open()` helper, and the `describe` names — and add a new block. Keep every existing test body; they all still apply to generate mode.

```tsx
import { NewProjectDialog } from './NewProjectDialog';
import type { NewProjectSubmission } from '@sudobility/music_lib';

function open(balance: number, siteAdmin = false, onSubmit = vi.fn()) {
  useBalance.mockReturnValue({ balance, isLoading: false });
  useSiteAdmin.mockReturnValue(siteAdmin);
  return {
    onSubmit,
    ...render(
      <MemoryRouter>
        <NewProjectDialog open onClose={vi.fn()} onSubmit={onSubmit} submitting={false} />
      </MemoryRouter>,
    ),
  };
}

/** Turns the AI half on. It is off by default: this is New Project, not Generate. */
function turnGenerationOn() {
  fireEvent.click(screen.getByRole('switch', { name: 'Generate for me' }));
}
```

Every existing test that asserts on Prompt, Style, the estimate or the Generate button must now call `turnGenerationOn()` first, and must look for a button named **`Create`** rather than `Generate`. Then append:

```tsx
describe('NewProjectDialog: the Generate for me toggle', () => {
  it('starts off, and hides every AI field while it is', () => {
    // Off is the default because this is New Project. The AI block is prompt,
    // presets, style, mood, complexity, model and the credit line — all of it
    // or none of it, so there is one rule to learn rather than an exception.
    open(1000);
    expect(screen.getByRole('switch', { name: 'Generate for me' })).not.toBeChecked();
    for (const label of ['Prompt', 'Style', 'Mood', 'Complexity', 'Model']) {
      expect(screen.queryByLabelText(label), label).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/about \d+ credits/i)).not.toBeInTheDocument();
  });

  it('shows them all when it is turned on', () => {
    open(1000);
    turnGenerationOn();
    for (const label of ['Prompt', 'Style', 'Mood', 'Complexity', 'Model']) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it('keeps Instrumentation and everything below it in both modes', () => {
    open(1000);
    for (const label of ['Add instrument', 'Bars', 'Tempo', 'Key', 'Mode', 'Time signature']) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    turnGenerationOn();
    for (const label of ['Add instrument', 'Bars', 'Tempo', 'Key', 'Mode', 'Time signature']) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it('does not throw away a typed prompt when it is switched off and back on', () => {
    // Losing text to a toggle is never worth the tidiness.
    open(1000);
    turnGenerationOn();
    fillPrompt();
    turnGenerationOn();
    turnGenerationOn();
    expect(screen.getByLabelText('Prompt')).toHaveValue('A waltz');
  });
});

describe('NewProjectDialog: creating', () => {
  it('creates a blank score with no prompt at all', () => {
    const { onSubmit } = open(1000);
    setMeasures(4);
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    expect(submission.kind).toBe('blank');
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.score.tracks).toHaveLength(1);
    expect(submission.score.tracks[0]?.measures).toHaveLength(4);
  });

  it('carries the chosen instruments, programs and all', () => {
    const { onSubmit } = open(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.score.tracks).toHaveLength(2);
    expect(submission.score.tracks.every((t) => typeof t.midiProgram === 'number')).toBe(true);
  });

  it('names the project Untitled Project when the Title is blank', () => {
    // The score inside says "Untitled"; the row in a list of rows needs a name
    // a reader can tell from the others.
    const { onSubmit } = open(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.title).toBe('Untitled Project');
    expect(submission.score.metadata.title).toBe('Untitled');
  });

  it('submits a request, not a score, once generation is on', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    expect(submission.kind).toBe('generate');
    if (submission.kind !== 'generate') throw new Error('expected a generate submission');
    expect(submission.request.prompt).toBe('A waltz');
  });

  it('does not refuse a blank project to somebody with no credits', () => {
    // A blank project costs nothing. Refusing it would be refusing work the
    // server never charges for.
    open(0);
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('still refuses a generation to somebody with no credits', () => {
    open(0);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('refuses a blank project with no bars, the same rule as a generation', () => {
    open(1000);
    setMeasures(0);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- NewProjectDialog
```

Expected: FAIL — no `switch` role named "Generate for me", and no button named "Create".

- [ ] **Step 4: Implement**

In `src/features/projects/NewProjectDialog.tsx`:

Rename the exported symbols:

```tsx
export type NewProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Receives what was asked for; the caller decides where it lands. */
  onSubmit: (submission: NewProjectSubmission) => void;
  /** True while the project is being created, to disable the CTA. */
  submitting?: boolean;
};

export function NewProjectDialog({ open, onClose, onSubmit, submitting = false }: NewProjectDialogProps) {
```

Add `Switch` to the `@sudobility/components` import, and
`buildNewProjectScore, canBuildNewProjectScore, type NewProjectSubmission` to the `@sudobility/music_lib` import.

Add the state, beside `title`:

```tsx
/*
    Whether a model writes the music.

    Off by default: this is New Project, and a blank score with the right
    instruments is the ordinary way to start one. On, the form is exactly the
    Generate dialog it grew out of.

    Flipping it never clears anything. Somebody who types a prompt, turns this
    off and turns it back on gets their prompt back — losing typed text to a
    toggle is not worth the tidiness.
  */
const [generateForMe, setGenerateForMe] = useState(false);
```

Replace `canGenerate` and `handleGenerate`:

```tsx
/*
    One rule per mode, both from music_lib, so the form cannot offer a Create
    the builder would then refuse. `outOfCredits` gates generation only — a
    blank project costs nothing, and refusing it would refuse work the server
    never charges for.
  */
const canCreate =
  !submitting &&
  (generateForMe
    ? !outOfCredits && canBuildGenerateScoreRequest(generationDraft)
    : canBuildNewProjectScore(generationDraft));

const handleCreate = (): void => {
  if (!canCreate) return;
  if (generateForMe) {
    const request = buildGenerateScoreRequest(generationDraft);
    if (!request) return;
    onSubmit({ kind: 'generate', request: withGenerationVariant(request, variant) });
    return;
  }
  const score = buildNewProjectScore(generationDraft);
  if (!score) return;
  // The score's title and the project's name are different things: the score
  // says "Untitled", the row in a list needs something a reader can pick out.
  onSubmit({ kind: 'blank', title: title.trim() || t('newProject.untitled'), score });
};
```

Change the `FormModal`:

```tsx
      title={t('newProject.title')}
      ...
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('dashboard.create'),
          onClick: handleCreate,
          variant: 'primary',
          disabled: !canCreate,
          loading: submitting,
          loadingLabel: t('common.loading'),
        },
      ]}
```

Wrap the credits paragraph, the prompt row, the four-select row (Style / Mood / Complexity / Model) in `{generateForMe && ( ... )}`. Leave the Title label, the Instrumentation group, the Bars/Tempo row and the Key/Mode/Time-signature row outside it.

Insert the toggle immediately after the Title label:

```tsx
{
  /* Under the Title, because it is the next thing you decide: whether
            anything is written for you, or you get the staves and write it. */
}
<label className="flex items-center gap-3">
  <Switch
    checked={generateForMe}
    onCheckedChange={setGenerateForMe}
    aria-label={t('newProject.generateForMe')}
  />
  <span className="flex flex-col">
    <span className="text-sm text-theme-text-primary">{t('newProject.generateForMe')}</span>
    <span className="text-xs text-theme-text-secondary">{t('newProject.generateForMeHint')}</span>
  </span>
</label>;
```

Finally, update the file's doc comment: it currently describes a whole-score generation panel. Say what it is now — a New Project modal whose Generate-for-me toggle chooses between two builders over one draft — and keep the paragraphs about the seed/candidateCount omissions, the library-sweep control choices and the hand-built preset menu, which are all still true.

- [ ] **Step 5: Run them and watch them pass**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- NewProjectDialog
```

Expected: PASS, including every migrated test.

- [ ] **Step 6: Verify by sabotage**

Change `canBuildNewProjectScore(generationDraft)` to `canBuildGenerateScoreRequest(generationDraft)`. Re-run: "creates a blank score with no prompt at all" must fail because Create is disabled. Put it back.

- [ ] **Step 7: Check the locales**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- locale-parity
```

Expected: PASS. A failure here means the `zh` block is missing or has no CJK.

---

### Task 5: The dashboard toolbar

Spec §3.1–3.3.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app/src/features/projects/DashboardPage.tsx`
- Test: `/Users/johnhuang/projects/music_app/src/features/projects/DashboardPage.test.tsx`

**Interfaces:**

- Consumes: `NewProjectDialog` and `NewProjectSubmission` (Task 4).
- Produces: nothing new exported; `DashboardPageProps` is unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the two import tests in `DashboardPage.test.tsx` and add the new-project ones:

```tsx
/** Opens the Import menu and picks one item by its visible label. */
async function chooseImport(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Import a file' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

it('offers every kind of import from one control, since each one makes a new project', async () => {
  // Five buttons that differed by a word were one decision — which file —
  // spread across five controls.
  const { store } = setup();
  render(<DashboardPage store={store} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole('combobox', { name: 'Import a file' }));
  for (const label of [
    'Import MIDI',
    'Import MusicXML',
    'Import Audio',
    'Import MOD',
    'Import project JSON',
  ]) {
    expect(screen.getByRole('option', { name: label }), label).toBeInTheDocument();
  }
});

it('opens a modal for every import, not the OS picker', async () => {
  const { store } = setup();
  render(<DashboardPage store={store} />);
  const user = userEvent.setup();

  for (const [item, title] of [
    ['Import MOD', 'Import module'],
    ['Import project JSON', 'Import project JSON'],
    ['Import Audio', 'Import audio'],
  ] as const) {
    await chooseImport(user, item);
    expect(await screen.findByRole('dialog', { name: title }), item).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  }
});

it('keeps reading "Import" after one has been chosen', async () => {
  // A menu, not a value: the trigger must not become "MusicXML" and leave the
  // reader with no word for what the control does.
  const { store } = setup();
  render(<DashboardPage store={store} />);
  const user = userEvent.setup();

  await chooseImport(user, 'Import MOD');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('combobox', { name: 'Import a file' })).toHaveTextContent('Import');
});

it('accepts the formats each import claims to', async () => {
  const { store } = setup();
  render(<DashboardPage store={store} />);
  const user = userEvent.setup();

  await chooseImport(user, 'Import Audio');
  const audio = (await screen.findByLabelText('audio file input')) as HTMLInputElement;
  for (const ext of ['.wav', '.mp3', '.mpa']) expect(audio.accept).toContain(ext);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));

  await chooseImport(user, 'Import MOD');
  const mod = (await screen.findByLabelText('module file input')) as HTMLInputElement;
  expect(mod.accept).toContain('.mod');
});

it('New Project opens the modal and creates a blank project on the server', async () => {
  const { store, context } = setup();
  const onNavigate = vi.fn();
  render(<DashboardPage store={store} onNavigate={onNavigate} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'New Project' }));
  await user.type(await screen.findByLabelText('Title', { exact: true }), 'String Quartet');
  await user.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(onNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/project\//)),
  );
  const rows = await context.fakeClient.listProjects('token', { sort: 'updatedAt' });
  expect(rows.map((r) => r.name)).toContain('String Quartet');
});

it('no longer carries a separate Generate Score button', async () => {
  // One decision, asked once: generating and not generating differ only in
  // whether a prompt is sent.
  const { store } = setup();
  render(<DashboardPage store={store} />);
  expect(screen.queryByRole('button', { name: 'Generate Score' })).not.toBeInTheDocument();
});
```

In `describe('DashboardPage generation')`, replace "offers Generate Score" and "opens the whole-score dialog" with:

```tsx
it('reaches whole-score generation through the New Project modal', async () => {
  const { store } = setup();
  render(<DashboardPage store={store} />);
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'New Project' }));
  expect(await screen.findByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
  await user.click(screen.getByRole('switch', { name: 'Generate for me' }));
  expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
});
```

`'creates the project up front so it appears while it generates'` keeps its assertions but must now open the modal and turn the toggle on before filling the prompt.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- DashboardPage
```

Expected: FAIL — no combobox named "Import a file".

- [ ] **Step 3: Rewrite the toolbar**

In `DashboardPage.tsx`, replace the `GenerateScoreDialog` import with:

```tsx
import { NewProjectDialog } from '@/features/projects/NewProjectDialog';
import type { NewProjectSubmission } from '@sudobility/music_lib';
```

Replace the `creatingName`, `generateOpen` and `creatingGeneration` state with:

```tsx
const [newProjectOpen, setNewProjectOpen] = useState(false);
const [creatingProject, setCreatingProject] = useState(false);
```

Rename `setGenerateOpen(false)` to `setNewProjectOpen(false)` and `setCreatingGeneration` to `setCreatingProject` throughout `startWholeScoreGeneration`, which is otherwise unchanged — including its rule that a refused job deletes the project it just created.

Replace `handleCreate` with the submission handler:

```tsx
/**
 * Turns what the modal asked for into a project.
 *
 * The modal reports the *decision*; where it lands is this page's business,
 * which is what lets the same form back a local document on the native side.
 */
const handleNewProject = async (submission: NewProjectSubmission): Promise<void> => {
  if (submission.kind === 'generate') {
    // The dialog chooses the backend; the developer setting fills in when it
    // did not.
    await startWholeScoreGeneration(
      submission.request.variant
        ? submission.request
        : withGenerationVariant(submission.request, store.getState().devSettings.generationVariant),
    );
    return;
  }
  setCreatingProject(true);
  try {
    await store.getState().newProject({ name: submission.title, score: submission.score });
    const id = store.getState().projectId;
    resetOpenedProjectTransport();
    setNewProjectOpen(false);
    await refresh();
    if (id) onNavigate?.(`/project/${id}`);
  } catch (err) {
    reportError(err, { context: t('errors.createProject'), store });
  } finally {
    setCreatingProject(false);
  }
};
```

Add the import vocabulary above the component, beside `ROW_CONTROL_CLASS`:

```tsx
/**
 * What the Import menu offers.
 *
 * A closed vocabulary declared as an array with the type read off it, so the
 * switch below fails to compile when a format is added without a home.
 */
const IMPORT_KINDS = ['midi', 'musicxml', 'audio', 'module', 'project'] as const;
type ImportKind = (typeof IMPORT_KINDS)[number];

/** The label each one shows. A `Record`, so a new kind cannot ship unlabelled. */
const IMPORT_LABEL_KEYS: Record<ImportKind, string> = {
  midi: 'dashboard.importMidi',
  musicxml: 'dashboard.importMusicXml',
  audio: 'dashboard.importAudio',
  module: 'dashboard.importModule',
  project: 'dashboard.importProject',
};
```

Add the dispatcher inside the component, next to the other handlers (it carries the audio capability probe that the Import Audio button used to own):

```tsx
const openImport = (kind: ImportKind): void => {
  if (kind === 'midi') setMidiImportOpen(true);
  else if (kind === 'musicxml') setMusicXmlImportOpen(true);
  else if (kind === 'module') setModImportOpen(true);
  else if (kind === 'project') setJsonImportOpen(true);
  else {
    setAudioError(null);
    setAudioImportOpen(true);
    // Probed per opening, not once per session: a deployment can gain or lose
    // its credentials while a tab stays open.
    void (async () => {
      try {
        const { client, token } = await clientAndToken();
        setCanTranscribe((await client.getTranscriptionCapability(token)).available);
      } catch {
        // Left unknown rather than false: a failed probe says nothing about
        // whether transcription works, and the POST reports its own 503.
        setCanTranscribe(null);
      }
    })();
  }
};
```

Replace the whole toolbar row — from the search `Input` through the last import `Tooltip` — with:

```tsx
        <Input
          type="text"
          aria-label={t('dashboard.searchProjects')}
          placeholder={t('dashboard.searchProjects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={TEXT_INPUT_CLASS}
        />

        {/*
          A menu, not a value. Held at `value=""` so Radix keeps rendering the
          placeholder — the trigger must go on reading "Import" rather than
          becoming "MusicXML" after one use — and so `onValueChange` fires on
          every selection, which a controlled Select does because it never
          adopts the value itself.
        */}
        <Select value="" onValueChange={(v) => openImport(v as ImportKind)}>
          <SelectTrigger aria-label={t('dashboard.importFormat')} className={SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder={t('dashboard.import')} />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(IMPORT_LABEL_KEYS[kind])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="primary"
          aria-label={t('dashboard.newProject')}
          onClick={() => setNewProjectOpen(true)}
          className={ROW_BUTTON_CLASS}
        >
          {t('dashboard.newProject')}
        </Button>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger aria-label={t('dashboard.sortProjects')} className={SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">{t('dashboard.sortUpdated')}</SelectItem>
            <SelectItem value="name">{t('dashboard.sortName')}</SelectItem>
          </SelectContent>
        </Select>
```

Point the empty state's action at the modal:

```tsx
            onPress={() =>
              search.trim() === '' ? setNewProjectOpen(true) : setSearch('')
            }
```

Replace the `GenerateScoreDialog` element at the bottom:

```tsx
<NewProjectDialog
  open={newProjectOpen}
  onClose={() => setNewProjectOpen(false)}
  submitting={creatingProject}
  onSubmit={(submission) => void handleNewProject(submission)}
/>
```

Remove the now-unused `Tooltip` import if nothing else in the file uses it, and update the file's doc comment: the toolbar is one Import select and one New Project button now, and the paragraph describing five import buttons and their Tooltips is no longer true.

- [ ] **Step 4: Run them and watch them pass**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- DashboardPage
```

Expected: PASS.

- [ ] **Step 5: Verify by sabotage**

Change `<Select value="" ...>` to `<Select onValueChange={...}>` (uncontrolled). Re-run: "keeps reading Import after one has been chosen" must fail. Put it back — this is the one non-obvious thing about using a Select as a menu, and the test exists to catch its regression.

---

### Task 6: Retire the dead copy

Spec §3.4. Separated from Task 5 so a reviewer can reject a copy change without rejecting the toolbar.

**Files:**

- Modify: `public/locales/en/app.json`, `public/locales/zh/app.json`

- [ ] **Step 1: Add the two new dashboard keys**

`en`, inside `dashboard`:

```json
"import": "Import",
"importFormat": "Import a file",
```

`zh`, inside `dashboard`:

```json
"import": "导入",
"importFormat": "导入文件",
```

- [ ] **Step 2: Remove the keys nothing renders any more**

From **both** locales' `dashboard` block, delete: `newProjectName`, `generateScore`, `generateScoreHint`, `importAudioHint`, `importModuleHint`.

Keep `importMidi`, `importMusicXml`, `importAudio`, `importModule` and `importProject` — they are the menu items' labels now, and `importProject` is also the JSON modal's title. Keep `create`, which is the modal's CTA.

- [ ] **Step 3: Prove nothing still asks for them**

```bash
cd /Users/johnhuang/projects/music_app
grep -rn "dashboard.newProjectName\|dashboard.generateScore\|dashboard.importAudioHint\|dashboard.importModuleHint" src/ e2e/
```

Expected: no output. Any hit is a call site the toolbar rewrite missed.

- [ ] **Step 4: Verify**

```bash
cd /Users/johnhuang/projects/music_app && bun run test -- locale-parity && bun run test -- docs-content
```

Expected: PASS both.

---

### Task 7: The Playwright suite

Spec §3.5. Seven files reach the dashboard through controls that no longer exist.

**Files:**

- Modify: `e2e/helpers.ts`, `e2e/docs.spec.ts`, `e2e/credits.spec.ts`, `e2e/acceptance.spec.ts:146`, `e2e/midi-roundtrip.spec.ts:46`, `e2e/mod-import.spec.ts:41,68`, `e2e/musicxml-export.spec.ts:49`

**Interfaces:**

- Consumes: the toolbar from Task 5.
- Produces, for the other specs, in `e2e/helpers.ts`:

```ts
export async function chooseImport(page: Page, label: string): Promise<void>;
```

- [ ] **Step 1: Add the shared import helper**

In `e2e/helpers.ts`:

```ts
/**
 * Picks one format out of the dashboard's Import menu.
 *
 * The five import buttons became one Select — a menu whose trigger keeps
 * reading "Import" — so every spec that used to click a button by name now
 * opens this and chooses an option.
 */
export async function chooseImport(page: Page, label: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Import a file' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
```

- [ ] **Step 2: Rewrite `createProject`**

```ts
export async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByLabel('Edit project title')).toBeVisible();
}
```

Read the existing body first and keep whatever navigation it does before the button click; only the three lines from the button through Create change.

- [ ] **Step 3: Rewrite `generateWholeScore`'s opening and its submit**

Replace:

```ts
await page.getByRole('button', { name: 'Generate Score', exact: true }).click();
```

with:

```ts
await page.getByRole('button', { name: 'New Project', exact: true }).click();
// Generation is a toggle on the New Project form now, and it starts off.
await page.getByRole('switch', { name: 'Generate for me' }).click();
```

and replace:

```ts
await page.getByRole('button', { name: 'Generate', exact: true }).click();
```

with:

```ts
await page.getByRole('button', { name: 'Create', exact: true }).click();
```

Everything between — Title, Prompt, Bars, Key, Mode, Tempo — is unchanged, and the comment about `exact: true` because Playwright matches by substring still applies.

- [ ] **Step 4: Update the six specs**

| File                      | line   | from                                                        | to                                                                                             |
| ------------------------- | ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `acceptance.spec.ts`      | 146    | `page.getByRole('button', { name: 'Import MIDI' }).click()` | `chooseImport(page, 'Import MIDI')`                                                            |
| `midi-roundtrip.spec.ts`  | 46     | same                                                        | `chooseImport(page, 'Import MIDI')`                                                            |
| `musicxml-export.spec.ts` | 49     | `... 'Import MusicXML' ...`                                 | `chooseImport(page, 'Import MusicXML')`                                                        |
| `mod-import.spec.ts`      | 41, 68 | `... 'Import MOD', exact: true ...`                         | `chooseImport(page, 'Import MOD')`                                                             |
| `credits.spec.ts`         | 61     | `... 'Generate Score', exact: true ...`                     | the two lines from Step 3                                                                      |
| `docs.spec.ts`            | 50–51  | `'New Project'` then `'Create'`                             | insert `await page.getByLabel('Title', { exact: true }).fill('Docs link check');` between them |

Add `chooseImport` to each file's import from `./helpers`. In `mod-import.spec.ts` also update the comment at line 39, which explains why `Import MOD` needed `exact: true` against a button — it is an option now.

- [ ] **Step 5: Run the suite**

```bash
cd /Users/johnhuang/projects/music_app
lsof -ti:5039,8023 | xargs -r kill
bun run test:e2e
```

This needs a local Postgres `music_test` database and `../music_api`'s dependencies installed. Killing 5039 and 8023 first is not optional: `reuseExistingServer` otherwise silently attaches to whatever is already there.

Expected: PASS. **If the environment will not provide Postgres or `music_api`, say so plainly in the report and do not claim the suite passed** — run `bun run test:e2e -- --list` at minimum to prove the specs still parse and the helper resolves.

- [ ] **Step 6: Verify the whole web app**

```bash
cd /Users/johnhuang/projects/music_app && bun run verify
```

Expected: typecheck, lint, vitest and build all pass.

---

### Task 8: Extract the RN score-setup form

Spec §4.1. Two 350-line copies of one form is two places for the style presets, the credit estimate and the instrument list to drift.

**Files:**

- Create: `/Users/johnhuang/projects/music_app_rn/src/features/generation/ScoreSetupFields.tsx`
- Modify: `/Users/johnhuang/projects/music_app_rn/src/features/generation/GenerateScoreSheet.tsx`
- Test: `src/features/generation/GenerateScoreSheet.test.tsx` (existing, must keep passing unchanged)

**Interfaces:**

- Consumes: `GENERATE_SCORE_*` options, `styleInstrumentsWithGuest`, `buildGenerateScoreRequest`, `estimateGenerateScoreCredits` (existing music_lib exports).
- Produces, for Task 9:

```tsx
export type ScoreSetupDraft = {
  title: string;
  setTitle: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  measuresText: string;
  setMeasuresText: (v: string) => void;
  tempoText: string;
  setTempoText: (v: string) => void;
  style: string;
  applyStyle: (v: string) => void;
  mood: string;
  setMood: (v: string) => void;
  complexity: GenerateScoreComplexity;
  setComplexity: (v: GenerateScoreComplexity) => void;
  timeSignature: string;
  setTimeSignature: (v: string) => void;
  fifths: string;
  setFifths: (v: string) => void;
  mode: 'major' | 'minor';
  setMode: (v: 'major' | 'minor') => void;
  instruments: readonly string[];
  setInstruments: (v: readonly string[]) => void;
  /** The same object both music_lib builders take. */
  draft: GenerateScoreRequestDraft;
};
export function useScoreSetupDraft(): ScoreSetupDraft;
export function ScoreSetupFields(props: {
  draft: ScoreSetupDraft;
  /** Renders the prompt, style, mood and complexity fields. */
  showAi: boolean;
}): JSX.Element;
```

- [ ] **Step 1: Confirm the existing tests pass before you touch anything**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- GenerateScoreSheet
```

Expected: PASS. This is the safety net for a pure extraction — write down how many tests there are.

- [ ] **Step 2: Create `ScoreSetupFields.tsx`**

Move, verbatim from `GenerateScoreSheet.tsx`: the `INSTRUMENT_OPTIONS` constant, the `NONE` sentinel, the `Field` component, every `useState`, `applyStyle` with its whole comment, the `draft` object, and the `<Field>` blocks for Title, Prompt, Bars, Tempo, Style, Mood, Complexity, Time signature, Key, Mode and Instrumentation.

The state and `applyStyle` become `useScoreSetupDraft()`; the `<Field>` blocks become `ScoreSetupFields`, with the Prompt, Style, Mood and Complexity fields wrapped in `{showAi && ( ... )}`.

Head the new file with:

```tsx
/**
 * The form both score-setup sheets show.
 *
 * `GenerateScoreSheet` asks for a whole score inside the project already open;
 * `NewProjectSheet` asks for a new one, with a toggle deciding whether a model
 * writes it. They differ in their title, their action and whether the AI half
 * is on screen — and in nothing else, so a second copy of this would be a
 * second place for the style presets, the credit estimate and the instrument
 * list to drift out of step.
 *
 * The draft is the *same object* music_lib's two builders take, which is what
 * lets one form back both: `buildGenerateScoreRequest` reads the prompt half,
 * `buildNewProjectScore` ignores it.
 */
```

- [ ] **Step 3: Rewrite `GenerateScoreSheet` to render it**

```tsx
export function GenerateScoreSheet({
  open,
  onClose,
  onSubmit,
  submitting = false,
  outOfCredits = false,
}: GenerateScoreSheetProps) {
  const { t } = useTranslation();
  const setup = useScoreSetupDraft();
  const request = buildGenerateScoreRequest(setup.draft);
  const credits = estimateGenerateScoreCredits(
    setup.draft.durationMeasures,
    setup.instruments.length,
  );

  return (
    <FormModal
      visible={open}
      title={t('generateScore.title')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onPress: onClose, variant: 'ghost' },
        {
          label: t('generate.action'),
          onPress: () => {
            if (request) onSubmit(request);
          },
          disabled: request === null || outOfCredits,
          loading: submitting,
        },
      ]}
    >
      {/*
        Scrolls inside the sheet: on a phone in landscape this is taller than
        the screen, and a form whose action is off the bottom is a form nobody
        can submit.
      */}
      <ScrollView keyboardShouldPersistTaps="handled">
        <ScoreSetupFields draft={setup} showAi />
        <Text className="text-muted-foreground text-sm">
          {t('generate.estimate', { count: credits })}
        </Text>
        {/*
          A courtesy gate, and only at zero. Deliberately not disabled when the
          estimate merely exceeds the balance: a job may overdraw once by
          design, and a stricter rule here would refuse work `POST /jobs` would
          have accepted.
        */}
        {outOfCredits ? (
          <Text className="text-destructive text-sm">{t('credits.outOfCreditsTitle')}</Text>
        ) : null}
      </ScrollView>
    </FormModal>
  );
}
```

- [ ] **Step 4: Run the same tests and watch them still pass**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- GenerateScoreSheet
```

Expected: PASS, the same count as Step 1. A pure extraction changes no behaviour; if a test fails, something moved that should not have.

- [ ] **Step 5: Verify by sabotage**

Pass `showAi={false}` in `GenerateScoreSheet`. Re-run: the tests that touch the prompt must fail. Put it back.

---

### Task 9: `NewProjectSheet`

Spec §4.1 and §4.3.

**Files:**

- Create: `/Users/johnhuang/projects/music_app_rn/src/features/projects/NewProjectSheet.tsx`
- Create: `/Users/johnhuang/projects/music_app_rn/src/features/projects/NewProjectSheet.test.tsx`

**Interfaces:**

- Consumes: `useScoreSetupDraft`, `ScoreSetupFields` (Task 8); `buildNewProjectScore`, `canBuildNewProjectScore`, `NewProjectSubmission` (Task 2).
- Produces, for Tasks 11 and 14:

```tsx
export type NewProjectSheetProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (submission: NewProjectSubmission) => void;
  submitting?: boolean;
  outOfCredits?: boolean;
  /**
   * Whether a model can write this one. False from the macOS File menu, where
   * the result is a local document and a job has no project row to write to.
   */
  generationAvailable?: boolean;
};
export function NewProjectSheet(props: NewProjectSheetProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`src/features/projects/NewProjectSheet.test.tsx` (a `.tsx`, so jest runs it):

```tsx
/**
 * The New Project sheet: what it hides, what it emits, and when the model is
 * not on offer at all.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { NewProjectSubmission } from '@sudobility/music_lib';
import { NewProjectSheet } from './NewProjectSheet';

function open(props: Partial<React.ComponentProps<typeof NewProjectSheet>> = {}) {
  const onSubmit = jest.fn();
  render(<NewProjectSheet open onClose={jest.fn()} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

describe('NewProjectSheet', () => {
  it('starts with the AI half off and out of sight', () => {
    open();
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    expect(screen.queryByLabelText('Style')).toBeNull();
  });

  it('shows the AI half once the toggle is on', () => {
    open();
    fireEvent(screen.getByLabelText('Generate for me'), 'valueChange', true);
    expect(screen.getByLabelText('Prompt')).toBeTruthy();
    expect(screen.getByLabelText('Style')).toBeTruthy();
  });

  it('keeps the instrumentation and the settings in both modes', () => {
    open();
    expect(screen.getByLabelText('Bars')).toBeTruthy();
    expect(screen.getByLabelText('Instrumentation')).toBeTruthy();
    fireEvent(screen.getByLabelText('Generate for me'), 'valueChange', true);
    expect(screen.getByLabelText('Bars')).toBeTruthy();
    expect(screen.getByLabelText('Instrumentation')).toBeTruthy();
  });

  it('emits a blank score with the chosen instrument', () => {
    const { onSubmit } = open();
    fireEvent.press(screen.getByText('Create'));

    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    expect(submission.kind).toBe('blank');
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.score.tracks).toHaveLength(1);
    expect(submission.title).toBe('Untitled Project');
  });

  it('does not offer the model when there is nothing for a job to write to', () => {
    // A local document has no project row on the server. Offering the toggle
    // would be offering something that cannot work.
    open({ generationAvailable: false });
    expect(screen.getByLabelText('Generate for me')).toBeDisabled();
    expect(screen.getByText('Generating needs a project on the server.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- NewProjectSheet
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```tsx
/**
 * Starting a new score, with or without a model writing it.
 *
 * The twin of the web's `NewProjectDialog`, over the same form and the same two
 * music_lib builders — so the toggle decides only which builder runs, and the
 * two apps cannot disagree about what a new project is.
 *
 * It emits a decision, not a project. Where it lands is the caller's: the
 * dashboard makes a project on the server, and the macOS File menu makes a
 * local document, which is why generation can be switched off entirely.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FormModal, Switch, Text } from '@sudobility/components-rn';
import {
  buildGenerateScoreRequest,
  buildNewProjectScore,
  canBuildGenerateScoreRequest,
  canBuildNewProjectScore,
  estimateGenerateScoreCredits,
} from '@sudobility/music_lib';
import type { NewProjectSubmission } from '@sudobility/music_lib';
import { ScoreSetupFields, useScoreSetupDraft } from '@/features/generation/ScoreSetupFields';

export type NewProjectSheetProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (submission: NewProjectSubmission) => void;
  submitting?: boolean;
  outOfCredits?: boolean;
  generationAvailable?: boolean;
};

export function NewProjectSheet({
  open,
  onClose,
  onSubmit,
  submitting = false,
  outOfCredits = false,
  generationAvailable = true,
}: NewProjectSheetProps) {
  const { t } = useTranslation();
  const setup = useScoreSetupDraft();
  /*
    Off by default: this is New Project, and a blank score with the right
    instruments is the ordinary way to start one. Flipping it never clears
    anything — losing typed text to a toggle is not worth the tidiness.
  */
  const [generateForMe, setGenerateForMe] = useState(false);
  const generating = generateForMe && generationAvailable;

  const credits = estimateGenerateScoreCredits(
    setup.draft.durationMeasures,
    setup.instruments.length,
  );

  /*
    One rule per mode, both from music_lib, so the sheet cannot offer a Create
    the builder would refuse. `outOfCredits` gates generation only: a blank
    project costs nothing.
  */
  const canCreate =
    !submitting &&
    (generating
      ? !outOfCredits && canBuildGenerateScoreRequest(setup.draft)
      : canBuildNewProjectScore(setup.draft));

  const handleCreate = (): void => {
    if (!canCreate) return;
    if (generating) {
      const request = buildGenerateScoreRequest(setup.draft);
      if (request) onSubmit({ kind: 'generate', request });
      return;
    }
    const score = buildNewProjectScore(setup.draft);
    if (!score) return;
    // The score says "Untitled"; a row in a list needs a name a reader can
    // tell from the others.
    onSubmit({
      kind: 'blank',
      title: setup.title.trim() || t('newProject.untitled'),
      score,
    });
  };

  return (
    <FormModal
      visible={open}
      title={t('newProject.title')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onPress: onClose, variant: 'ghost' },
        {
          label: t('dashboard.create'),
          onPress: handleCreate,
          disabled: !canCreate,
          loading: submitting,
        },
      ]}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-3 pb-3">
          <Switch
            checked={generateForMe}
            onCheckedChange={setGenerateForMe}
            disabled={!generationAvailable}
            accessibilityLabel={t('newProject.generateForMe')}
          />
          <View className="flex-1">
            <Text className="text-foreground text-base">{t('newProject.generateForMe')}</Text>
            <Text className="text-muted-foreground text-sm">
              {generationAvailable
                ? t('newProject.generateForMeHint')
                : t('newProject.generationNeedsServer')}
            </Text>
          </View>
        </View>

        <ScoreSetupFields draft={setup} showAi={generating} />

        {generating ? (
          <Text className="text-muted-foreground text-sm">
            {t('generate.estimate', { count: credits })}
          </Text>
        ) : null}
        {generating && outOfCredits ? (
          <Text className="text-destructive text-sm">{t('credits.outOfCreditsTitle')}</Text>
        ) : null}
      </ScrollView>
    </FormModal>
  );
}
```

The Title field lives inside `ScoreSetupFields` and is rendered first there, so the toggle sitting above it here is the one departure from the web's order. If a reviewer wants them identical, move the toggle render into `ScoreSetupFields` behind a slot prop — do not duplicate the Title field.

- [ ] **Step 4: Run them and watch them pass**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- NewProjectSheet
```

Expected: PASS, all five. The locale keys this needs are added in Task 15; until then `t()` returns the key and the tests that assert on visible text will fail — **do Task 15's `newProject` block now if you are running tasks out of order.**

- [ ] **Step 5: Verify by sabotage**

Change `showAi={generating}` to `showAi`. Re-run: "starts with the AI half off and out of sight" must fail. Put it back.

---

### Task 10: One Import control in RN

Spec §4.2.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app_rn/src/features/documents/ImportButtons.tsx`
- Test: `/Users/johnhuang/projects/music_app_rn/src/features/documents/ImportButtons.test.tsx` (exists)

**Interfaces:**

- Consumes: `useImport()` (existing).
- Produces: `ImportButtons` keeps its name, its export and its `onTranscribeAudio` prop, so `DashboardScreen` and `EditorScreen` need no change to keep working.

- [ ] **Step 1: Write the failing test**

Replace the body of `ImportButtons.test.tsx`'s assertions about four buttons with:

```tsx
it('offers every format from one control', () => {
  render(<ImportButtons />);
  fireEvent.press(screen.getByLabelText('Import a file'));
  for (const label of ['Import MIDI', 'Import MusicXML', 'Import module', 'Import Audio']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it('runs the importer for the format that was picked', () => {
  render(<ImportButtons />);
  fireEvent.press(screen.getByLabelText('Import a file'));
  fireEvent.press(screen.getByText('Import MIDI'));
  expect(run).toHaveBeenCalledWith('midi');
});
```

Read the existing file first and keep its mock of `useImport` — `run` above is that mock.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- ImportButtons
```

Expected: FAIL — no element labelled "Import a file".

- [ ] **Step 3: Implement**

Replace the `OFFERED` list and the button row:

```tsx
/**
 * What the Import menu offers, in one control.
 *
 * Four buttons that differed by a word were one decision — which file — spread
 * across four controls. Audio is among them and stays offered whether or not a
 * server is configured: it *says* why it cannot run rather than vanishing,
 * because a control that comes and goes teaches the reader nothing about where
 * to find it.
 *
 * A project document is deliberately absent. Opening one of those is File →
 * Open and Recent Documents, not an import — an import makes a new document
 * out of somebody else's format.
 */
const OFFERED = [
  { value: 'midi', labelKey: 'import.midi' },
  { value: 'musicxml', labelKey: 'import.musicXml' },
  { value: 'tracker', labelKey: 'import.tracker' },
  { value: 'audio', labelKey: 'import.audio' },
] as const;
```

and, in the returned tree, in place of the four `Button`s and the audio `Button`:

```tsx
{
  /*
        Held with no `value`, so the trigger goes on reading "Import" rather
        than becoming "MusicXML" after one use.
      */
}
<Select
  accessibilityLabel={t('dashboard.importFormat')}
  placeholder={t('dashboard.import')}
  options={OFFERED.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
  onValueChange={(value) => {
    if (value === 'audio') setAudioOpen(true);
    else void run(value as ImportFormat);
  }}
/>;
```

Swap `Button` for `Select` in the `@sudobility/components-rn` import if nothing else in the file uses `Button`. Update the file's doc comment: it describes buttons.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:components -- ImportButtons
```

Expected: PASS.

- [ ] **Step 5: Verify by sabotage**

Drop `'audio'` from `OFFERED`. Re-run: "offers every format from one control" must fail. Put it back.

---

### Task 11: New Project on the RN dashboard

Spec §4.2.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app_rn/src/screens/DashboardScreen.tsx`

**Interfaces:**

- Consumes: `NewProjectSheet` (Task 9), `getMusicClient()`, `context.token`, `useProjects`.
- Produces: nothing exported.

- [ ] **Step 1: Add the handler and the button to `ProjectList`**

Inside `ProjectList`, beside `transcribeAudio`:

```tsx
const [newProjectOpen, setNewProjectOpen] = useState(false);
const [creating, setCreating] = useState(false);

/**
 * Turns what the sheet asked for into a project on the server, then opens it.
 *
 * The same shape as the web dashboard's, including the rule that a refused
 * job deletes the project it just created: that project exists only to hold
 * the generation, and without this a user with no credits collects an empty
 * "Generated score" row on every attempt.
 */
const createProject = useCallback(
  async (submission: NewProjectSubmission) => {
    const client = getMusicClient();
    if (!client || !context.token) return;
    setCreating(true);
    try {
      if (submission.kind === 'blank') {
        const project = await client.createProject(
          { name: submission.title, score: submission.score },
          context.token,
        );
        setNewProjectOpen(false);
        await refetch();
        onOpened(project.id);
        return;
      }
      const project = await client.createProject(
        {
          name: submission.request.title?.trim() || 'Generated score',
          score: emptyScoreForRequest(submission.request),
        },
        context.token,
      );
      try {
        await client.createJob(
          { projectId: project.id, kind: 'generate-score', request: submission.request },
          context.token,
        );
      } catch (jobError) {
        await client.deleteProject(project.id, context.token).catch(() => {
          // Best effort: the refusal is what the user needs to hear about.
        });
        throw jobError;
      }
      setNewProjectOpen(false);
      await refetch();
      onOpened(project.id);
    } finally {
      setCreating(false);
    }
  },
  [context.token, refetch, onOpened],
);
```

Add to the imports: `useState` from `react`, `emptyScoreForRequest` from `@sudobility/music_lib`, `NewProjectSubmission` as a type from the same, and `NewProjectSheet` from `@/features/projects/NewProjectSheet`.

In `ListHeaderComponent`, above `<ImportButtons ...>`:

```tsx
<Button onPress={() => setNewProjectOpen(true)}>{t('dashboard.newProject')}</Button>
```

and after the `FlatList`, wrapping both in a `<View className="bg-background flex-1">` that is already there:

```tsx
<NewProjectSheet
  open={newProjectOpen}
  submitting={creating}
  onClose={() => setNewProjectOpen(false)}
  onSubmit={(submission) => void createProject(submission)}
/>
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run typecheck
```

Expected: clean. A complaint that `createJob` or `deleteProject` is missing from `MusicClient` means Task 3's rsync did not land — re-run it.

- [ ] **Step 3: Verify the RN suite so far**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test
```

Expected: PASS. `DashboardScreen` has no test of its own; this proves nothing it imports has broken.

---

### Task 12: `saveDocumentAs`, and autosave for new documents

Spec §5.3 and §4.4. Both are seams the File menu needs before it can be wired.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app_rn/src/documents/document-storage.ts`
- Modify: `/Users/johnhuang/projects/music_app_rn/src/documents/DocumentsContext.tsx`
- Modify: `/Users/johnhuang/projects/music_app_rn/src/app/App.tsx`
- Test: `/Users/johnhuang/projects/music_app_rn/src/documents/document-storage.test.ts`

**Interfaces:**

- Consumes: `DocumentStorage`, `markSaved`, `serializeDocument` (existing).
- Produces, for Task 14:

```ts
export async function saveDocumentAs(
  document: MusicDocument,
  storage: DocumentStorage,
  uri: string,
  onSaved?: OpenObserver,
): Promise<string>;
```

and in `DocumentsContext.tsx`:

```tsx
export function DocumentsProvider(props: {
  list: DocumentList;
  onDocumentChanged?: (document: MusicDocument) => void;
  children: ReactNode;
}): JSX.Element;
export function useDocumentChanged(): ((document: MusicDocument) => void) | undefined;
```

- [ ] **Step 1: Write the failing test**

Append to `src/documents/document-storage.test.ts`, following that file's existing fake-storage helper:

```ts
describe('saveDocumentAs', () => {
  it('writes to the chosen path and adopts it as the origin', () => {
    // Adopting the new path is what makes the *next* Save go there rather than
    // back to wherever the document came from.
  });

  it('leaves the document dirty when the write fails', async () => {
    // Marking it clean before the write is how a failed save leaves a document
    // that looks safe to close.
  });
});
```

Then fill both in against the file's existing fake:

```ts
it('writes to the chosen path and adopts it as the origin', async () => {
  const storage = fakeStorage();
  const document = documentWithScore();
  await saveDocumentAs(document, storage, '/chosen/Wedding March.moosiac');

  expect(storage.files.get('/chosen/Wedding March.moosiac')).toContain('"version":1');
  expect(document.origin).toEqual({ kind: 'file', uri: '/chosen/Wedding March.moosiac' });
  expect(document.dirty).toBe(false);
});

it('leaves the document dirty when the write fails', async () => {
  const storage = fakeStorage();
  storage.writeText = () => Promise.reject(new Error('disk full'));
  const document = documentWithScore();
  document.dirty = true;

  await expect(saveDocumentAs(document, storage, '/x.moosiac')).rejects.toThrow('disk full');
  expect(document.dirty).toBe(true);
  expect(document.origin.kind).not.toBe('file');
});
```

Read the existing test file first and reuse its own `fakeStorage()` and document builder rather than inventing new ones; the names above are placeholders for whatever it already calls them.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:unit -- document-storage
```

Expected: FAIL — `saveDocumentAs` is not exported.

- [ ] **Step 3: Implement `saveDocumentAs`**

In `document-storage.ts`, after `saveDocument`:

```ts
/**
 * Writes a document somewhere the user chose, and moves it there.
 *
 * Separate from `saveDocument`, which writes to wherever the document already
 * lives and falls back to a default directory for one that has never been
 * saved. That fallback is what autosave needs and exactly what Save As must not
 * do — the whole point of Save As is that a person is present to be asked.
 *
 * `markSaved` comes after the write, never before: a failed save that had
 * already marked the document clean leaves one that looks safe to close.
 */
export async function saveDocumentAs(
  document: MusicDocument,
  storage: DocumentStorage,
  uri: string,
  onSaved?: OpenObserver,
): Promise<string> {
  const score = document.store.getState().score;
  if (!score) throw new Error('Cannot save a document with no score.');
  await storage.writeText(uri, serializeDocument({ title: document.title, score }));
  markSaved(document, { kind: 'file', uri });
  onSaved?.(document);
  return uri;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:unit -- document-storage
```

Expected: PASS.

- [ ] **Step 5: Thread the change callback through the provider**

In `DocumentsContext.tsx`:

```tsx
/**
 * What to do when a document's score changes.
 *
 * The autosaver is built in the composition root, so nothing below it could
 * reach it — a document created from the File menu would have registered no
 * change callback and never autosaved. Passed through the provider rather than
 * imported, because who writes the bytes is the app's business and the tests
 * hand in a fake.
 */
const ChangedContext = createContext<((document: MusicDocument) => void) | undefined>(undefined);

export function DocumentsProvider({
  list,
  onDocumentChanged,
  children,
}: {
  list: DocumentList;
  onDocumentChanged?: (document: MusicDocument) => void;
  children: ReactNode;
}) {
  return (
    <DocumentsContext.Provider value={list}>
      <ChangedContext.Provider value={onDocumentChanged}>{children}</ChangedContext.Provider>
    </DocumentsContext.Provider>
  );
}

export function useDocumentChanged(): ((document: MusicDocument) => void) | undefined {
  return useContext(ChangedContext);
}
```

In `App.tsx`, hoist the autosaver out of the `useMemo`'s closure so the provider can be handed its `notify`. Change the `useMemo` to return both, and pass it down:

```tsx
const { list, notifyChanged } = useMemo(() => {
  // ...unchanged up to `const autosaver = createAutosaver({...})`
  documents.open(
    createDocument({
      id: 'scratch',
      title: 'Untitled',
      score: newProjectScore('Untitled'),
      onChanged: (d) => autosaver.notify(d),
    }),
  );
  return { list: documents, notifyChanged: (d: MusicDocument) => autosaver.notify(d) };
}, []);
```

```tsx
                  <DocumentsProvider list={list} onDocumentChanged={notifyChanged}>
```

Add `import type { MusicDocument } from '@/documents/document';` to `App.tsx`.

- [ ] **Step 6: Verify**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run typecheck && bun run test
```

Expected: clean and PASS.

---

### Task 13: The macOS menu resource and the bridge

Spec §5.1–5.2. Native only — nothing here is testable by the JS suites, which is why it is its own task.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app_rn/src/app/menu-commands.ts:18-27`
- Modify: `/Users/johnhuang/projects/music_app_rn/macos/music_app_rn-macOS/AppDelegate.mm:48-55`
- Modify: `/Users/johnhuang/projects/music_app_rn/macos/music_app_rn-macOS/Base.lproj/Main.storyboard:62-130`

**Interfaces:**

- Consumes: nothing.
- Produces, for Task 14: `MenuCommand` gains `'file.new' | 'file.open' | 'file.save' | 'file.saveAs' | 'import.audio'`.

- [ ] **Step 1: Extend the command list**

`src/app/menu-commands.ts`:

```ts
export const MENU_COMMANDS = [
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'import.midi',
  'import.musicxml',
  'import.tracker',
  'import.audio',
  'export.midi',
  'export.musicxml',
  'export.xm',
  'export.wav',
  'export.mp3',
] as const;
```

- [ ] **Step 2: Answer the new selectors in the app delegate**

`AppDelegate.mm`, beside the existing eight:

```objc
- (void)moosiacFileNew:(id)sender { [self postMenuCommand:@"file.new"]; }
- (void)moosiacFileOpen:(id)sender { [self postMenuCommand:@"file.open"]; }
- (void)moosiacFileSave:(id)sender { [self postMenuCommand:@"file.save"]; }
- (void)moosiacFileSaveAs:(id)sender { [self postMenuCommand:@"file.saveAs"]; }
- (void)moosiacImportAudio:(id)sender { [self postMenuCommand:@"import.audio"]; }
```

The delegate must answer the selector for AppKit to enable the item at all — an item whose selector nobody implements is greyed out with no explanation, which is why New, Open, Save and Save As have never worked.

- [ ] **Step 3: Repoint the storyboard's four dead items**

In `Main.storyboard`, replace each `<action selector="...">` inside the File menu. The `target` and the `id` on each `<action>` stay exactly as they are — an `id` must be unique in the document and changing one for no reason invites a duplicate.

| line | old selector      | new selector         |
| ---- | ----------------- | -------------------- |
| 64   | `newDocument:`    | `moosiacFileNew:`    |
| 69   | `openDocument:`   | `moosiacFileOpen:`   |
| 93   | `saveDocument:`   | `moosiacFileSave:`   |
| 98   | `saveDocumentAs:` | `moosiacFileSaveAs:` |

Also change line 91's `title="Save…"` to `title="Save"`. It writes without asking whenever the document has a file, and an ellipsis promises a dialog.

- [ ] **Step 4: Add Audio to the Import submenu**

After the `Module…` item (line 123–129), inside `<menu key="submenu" title="Import" id="im0-00-000M">`:

```xml
                                            <menuItem title="Audio…" id="im4-00-004">
                                                <modifierMask key="keyEquivalentModifierMask"/>
                                                <connections>
                                                    <action selector="moosiacImportAudio:" target="Ady-hI-5gd" id="im4-00-004A"/>
                                                </connections>
                                            </menuItem>
```

- [ ] **Step 5: Check the storyboard still parses and the ids are unique**

```bash
cd /Users/johnhuang/projects/music_app_rn
xmllint --noout macos/music_app_rn-macOS/Base.lproj/Main.storyboard && echo "XML OK"
grep -o 'id="[^"]*"' macos/music_app_rn-macOS/Base.lproj/Main.storyboard | sort | uniq -d
```

Expected: `XML OK`, then **no output** from the duplicate check. Any duplicate id is a storyboard Xcode will refuse to load.

- [ ] **Step 6: Check the selectors line up on both sides**

```bash
cd /Users/johnhuang/projects/music_app_rn
for s in moosiacFileNew moosiacFileOpen moosiacFileSave moosiacFileSaveAs moosiacImportAudio; do
  printf '%s storyboard=%s delegate=%s\n' "$s" \
    "$(grep -c "$s:" macos/music_app_rn-macOS/Base.lproj/Main.storyboard)" \
    "$(grep -c "(void)$s:" macos/music_app_rn-macOS/AppDelegate.mm)"
done
```

Expected: every line reads `storyboard=1 delegate=1`. A `storyboard=1 delegate=0` is a permanently greyed menu item — the exact bug this task is fixing.

Note in the report that these are static checks: proving the items actually fire needs a full Xcode macOS build, which is the user's to run.

---

### Task 14: `MenuFileCommands`

Spec §5.3. New, Open, Save and Save As, wired to the seams Tasks 9 and 12 built.

**Files:**

- Create: `/Users/johnhuang/projects/music_app_rn/src/features/documents/MenuFileCommands.tsx`
- Modify: `/Users/johnhuang/projects/music_app_rn/src/app/App.tsx`

**Interfaces:**

- Consumes: `MenuCommand` (Task 13), `NewProjectSheet` (Task 9), `saveDocumentAs` and `useDocumentChanged` (Task 12), `openDocument`, `saveDocument`, `newDocument`, `createFilePicker`, `documentFilename`, `DOCUMENT_EXTENSION`, `useRecentTracking`.
- Produces: `export function MenuFileCommands(): JSX.Element`.

- [ ] **Step 1: Implement**

```tsx
/**
 * The File menu's New, Open, Save and Save As.
 *
 * Mounted once above the navigator, beside `MenuImportCommands` and for the
 * same reason: these act on documents rather than on a screen, and New in
 * particular has to work from wherever you are. A third listener on the same
 * event is what the two existing ones already do — each acts on its own
 * commands and ignores the rest, which is what stops two of them acting on one
 * menu item.
 *
 * **New makes a local document, and generation is not on offer here.** A job
 * writes its result back to a project row on the server, and a local file has
 * none; offering the toggle would be offering something that cannot work. The
 * dashboard is where a generated project is started.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Text } from '@sudobility/components-rn';
import { useMenuCommand } from '@/app/menu-commands';
import type { MenuCommand } from '@/app/menu-commands';
import {
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs,
} from '@/documents/document-storage';
import { documentFilename, DOCUMENT_EXTENSION } from '@/documents/document-file';
import { createFilePicker } from '@/documents/file-picker';
import { createFileStorage } from '@/documents/rn-storage';
import { createKeyValueStore } from '@/documents/rn-key-value';
import { useRecentTracking } from '@/documents/useRecentTracking';
import {
  useActiveDocument,
  useDocumentChanged,
  useDocumentList,
} from '@/documents/DocumentsContext';
import { NewProjectSheet } from '@/features/projects/NewProjectSheet';

const storage = createFileStorage();
const keyValue = createKeyValueStore();

export function MenuFileCommands() {
  const { t } = useTranslation();
  const list = useDocumentList();
  const document = useActiveDocument();
  const onChanged = useDocumentChanged();
  const recordRecent = useRecentTracking(keyValue);
  const [newOpen, setNewOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Writes the document somewhere the user picks.
   *
   * Also what Save falls back to for a document that has never been written:
   * `saveDocument`'s own fallback puts it in a default directory without
   * asking, which is right for autosave and wrong for a menu command, where a
   * person is present to be asked.
   */
  const saveAs = useCallback(async (): Promise<void> => {
    if (!document) return;
    const picker = createFilePicker();
    if (!picker.isSupported()) {
      setFailure(t('import.unsupported'));
      return;
    }
    const uri = await picker.pickSaveLocation(documentFilename(document.title));
    // Cancelling is an ordinary outcome, not a failure to report.
    if (!uri) return;
    await saveDocumentAs(document, storage, uri, recordRecent);
  }, [document, recordRecent, t]);

  const run = useCallback(
    (command: MenuCommand): void => {
      void (async () => {
        try {
          if (command === 'file.new') {
            setNewOpen(true);
          } else if (command === 'file.open') {
            const picker = createFilePicker();
            if (!picker.isSupported()) {
              setFailure(t('import.unsupported'));
              return;
            }
            const uri = await picker.pickFile([DOCUMENT_EXTENSION]);
            if (!uri) return;
            await openDocument(list, storage, uri, onChanged, recordRecent);
          } else if (command === 'file.saveAs') {
            await saveAs();
          } else if (command === 'file.save') {
            if (!document) return;
            // A document that already has a file goes back to it; one that does
            // not has to be asked about, which is Save As.
            if (document.origin.kind === 'file') {
              await saveDocument(document, storage, recordRecent);
            } else {
              await saveAs();
            }
          }
          // Import and export commands reach this listener too. They are
          // handled above the navigator and in the editor respectively, and
          // ignoring them here is what keeps two handlers off one menu item.
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [document, list, onChanged, recordRecent, saveAs, t],
  );

  useMenuCommand(run);

  return (
    <>
      <NewProjectSheet
        open={newOpen}
        generationAvailable={false}
        onClose={() => setNewOpen(false)}
        onSubmit={(submission) => {
          setNewOpen(false);
          // `generationAvailable={false}` means the sheet cannot produce a
          // generate submission; the guard is here so a future change to that
          // prop cannot silently drop one on the floor.
          if (submission.kind !== 'blank') return;
          newDocument(list, submission.score, submission.title, onChanged);
        }}
      />
      {/*
        A save that silently did nothing is how work is lost, so a failure is
        shown rather than swallowed — the same reason `ImportFeedback` exists.
      */}
      <FormModal
        visible={failure !== null}
        title={t('document.saveFailedTitle')}
        onClose={() => setFailure(null)}
        onSave={() => setFailure(null)}
        saveLabel={t('common.ok')}
        closeAriaLabel={t('common.closeDialog')}
      >
        <Text className="text-foreground text-base">{failure}</Text>
      </FormModal>
    </>
  );
}
```

- [ ] **Step 2: Mount it**

In `App.tsx`, beside `<MenuImportCommands />`:

```tsx
                    <MenuImportCommands />
                    <MenuFileCommands />
```

with `import { MenuFileCommands } from '@/features/documents/MenuFileCommands';`.

- [ ] **Step 3: Typecheck and run the suites**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run typecheck && bun run test
```

Expected: clean and PASS. On iOS, Android and under both test runners `NativeModules.MoosiacMenuBridge` is absent, `emitter` stays null and `useMenuCommand` subscribes to nothing — so mounting this changes nothing off macOS, which is the guard `menu-commands.ts` was written around.

- [ ] **Step 4: Give `import.audio` a handler**

Audio is not a `run(format)` import — it uploads to the server rather than
decoding locally — so Task 10 put it behind a sheet, and `MenuImportCommands`'
`IMPORT_FOR` map cannot carry it. Wire it in that component, which already sits
inside `AuthProvider` and so can build the upload itself; the result is opened
as a document rather than navigated to, which needs no navigator.

In `MenuImportCommands.tsx`:

```tsx
const [audioOpen, setAudioOpen] = useState(false);
const [uploading, setUploading] = useState(false);
const { getToken } = useAuth();
const list = useDocumentList();

/**
 * Uploads a recording and opens the project it becomes.
 *
 * Through `openProjectDocument` rather than a navigation: this component is
 * above the navigator, and opening a document activates it, which is the
 * whole of what navigating there would have achieved. The score does not
 * exist yet — the project comes back `transcribing` and fills itself in when
 * the job lands, the same shape as a generation.
 */
const transcribeAudio = useCallback(
  async (file: NativeUploadFile) => {
    const client = getMusicClient();
    const token = await getToken();
    if (!client || !token) return;
    const saved = await client.transcribeAudio(file, file.name, token);
    await openProjectDocument(list, client, getToken, saved.id);
  },
  [getToken, list],
);
```

and in its returned tree, beside `<ImportFeedback state={importer} />`:

```tsx
<AudioImportSheet
  open={audioOpen}
  busy={uploading}
  available
  onClose={() => setAudioOpen(false)}
  onUpload={async (file) => {
    setUploading(true);
    try {
      await transcribeAudio(file);
      setAudioOpen(false);
    } finally {
      setUploading(false);
    }
  }}
/>
```

with `if (command === 'import.audio') { setAudioOpen(true); return; }` at the
top of the existing `useMenuCommand` callback, before the `IMPORT_FOR` lookup.

Add the imports it needs: `useCallback`/`useState` from `react`,
`AudioImportSheet` from `./AudioImportSheet`, `useAuth` from
`@/auth/AuthContext`, `getMusicClient` from `@/config/server`,
`openProjectDocument` from `@/documents/project-sync`, `useDocumentList` from
`@/documents/DocumentsContext`, and `NativeUploadFile` as a type from
`@sudobility/music_client`.

- [ ] **Step 5: Prove every command has a handler**

```bash
cd /Users/johnhuang/projects/music_app_rn
for c in file.new file.open file.save file.saveAs import.audio; do
  printf '%s sites=%s\n' "$c" \
    "$(grep -rl "'$c'" src/features src/app | wc -l | tr -d ' ')"
done
```

Expected: each line's count is at least 2 — the declaration in
`src/app/menu-commands.ts` and at least one handler under `src/features`. A
count of 1 is a menu item that is present and inert, which is the failure this
check exists to catch.

- [ ] **Step 6: Typecheck and run the suites again**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run typecheck && bun run test
```

Expected: clean and PASS.

---

### Task 15: RN copy, and the final sweep

Spec §3.4 and §4.

**Files:**

- Modify: `/Users/johnhuang/projects/music_app_rn/src/i18n/locales/en.json`, `src/i18n/locales/zh.json`

- [ ] **Step 1: Add the shared keys, English identical to the web's**

`en.json` — a new top-level `newProject` block plus three additions to `dashboard` and one to `document`:

```json
"newProject": {
  "title": "New Project",
  "generateForMe": "Generate for me",
  "generateForMeHint": "Let AI write the music. Off, you get an empty score with these instruments.",
  "generationNeedsServer": "Generating needs a project on the server.",
  "untitled": "Untitled Project"
}
```

```json
"dashboard": {
  "create": "Create",
  "import": "Import",
  "importFormat": "Import a file",
  "newProject": "New Project",
  ...
}
```

```json
"document": {
  "saveFailedTitle": "Could not save",
  ...
}
```

`newProject.title`, `generateForMe`, `generateForMeHint`, `untitled`, `dashboard.create`, `dashboard.import`, `dashboard.importFormat` and `dashboard.newProject` are **the same strings as the web's**, verbatim — `cross-app-parity.test.ts` fails otherwise. `newProject.generationNeedsServer` and `document.saveFailedTitle` are this app's alone.

- [ ] **Step 2: Translate them**

`zh.json`:

```json
"newProject": {
  "title": "新建项目",
  "generateForMe": "由 AI 生成",
  "generateForMeHint": "让 AI 谱写音乐。关闭时，你会得到一份使用这些乐器的空白乐谱。",
  "generationNeedsServer": "生成功能需要服务器上的项目。",
  "untitled": "未命名项目"
}
```

```json
"dashboard": { "create": "创建", "import": "导入", "importFormat": "导入文件", "newProject": "新建项目", ... }
```

```json
"document": { "saveFailedTitle": "无法保存", ... }
```

Keep each block's keys sorted the way its neighbours are — these files are alphabetical.

- [ ] **Step 3: Run both parity suites**

```bash
cd /Users/johnhuang/projects/music_app_rn && bun run test:unit -- parity
cd /Users/johnhuang/projects/music_app && bun run test -- locale-parity
```

Expected: PASS. `cross-app-parity` needs `../music_app` checked out, which it is; if it skips, that is the sibling being absent and it should not be.

- [ ] **Step 4: Full verification, both apps**

```bash
cd /Users/johnhuang/projects/music_lib   && bun run verify
cd /Users/johnhuang/projects/music_types && bun run verify
cd /Users/johnhuang/projects/music_app_rn && bun run verify
cd /Users/johnhuang/projects/music_app   && bun run verify
```

Expected: all four clean.

- [ ] **Step 5: Prove nothing still names a control that is gone**

```bash
cd /Users/johnhuang/projects/music_app
grep -rn "GenerateScoreDialog\|Generate Score" src/ e2e/ || echo "clean"
cd /Users/johnhuang/projects/music_app_rn
grep -rn "newDocument:\|openDocument:\|saveDocument:\|saveDocumentAs:" macos/music_app_rn-macOS/ || echo "clean"
```

Expected: `clean` from both. The second is the one that matters — a leftover AppKit selector is a menu item that silently does nothing.

- [ ] **Step 6: Report honestly**

Say, in the final message: which suites ran and passed; whether the Playwright suite actually ran or was blocked on Postgres/`music_api`; that the macOS menu was verified **statically only** (XML validity, unique ids, selector parity) and needs an Xcode build to prove it fires; and that `music_types` and `music_lib` are built and rsynced but **not published**, which they must be before either app ships.

---

## Self-Review

**Spec coverage.** §1.1 → Task 2. §1.2 → Task 1. §1.3 → Task 3. §2.1–2.3 → Task 4. §3.1–3.3 → Task 5. §3.4 → Tasks 4 and 6. §3.5 → Tasks 4, 5 and 7. §4.1 → Tasks 8 and 9. §4.2 → Tasks 10 and 11. §4.3 → Tasks 9 and 14. §4.4 → Task 12. §5.1–5.2 → Task 13. §5.3 → Tasks 12 and 14. §5.4 → no task: it describes the format that already exists and is used as-is. Copy → Tasks 4, 6 and 15.

**Type consistency.** `NewProjectSubmission`, `NewProjectDraft`, `buildNewProjectScore` and `canBuildNewProjectScore` are declared once in Task 2 and consumed under those exact names in Tasks 4, 5, 9, 11 and 14. `ScoreSetupDraft` / `useScoreSetupDraft` / `ScoreSetupFields` are declared in Task 8 and consumed in Task 9. `saveDocumentAs` and `useDocumentChanged` are declared in Task 12 and consumed in Task 14. `chooseImport` is declared in Task 7 Step 1 and used in Step 4. The `MenuCommand` members added in Task 13 are the ones Task 14 switches on.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Every code step carries the code. The one place the plan says "read the existing file first and reuse its helpers" — Task 12 Step 1 — names what those helpers do rather than what they are called, because the fake-storage builder in `document-storage.test.ts` must not be duplicated under a new name.

**Earlier draft's loose end, now closed.** Task 14 originally left `import.audio` possibly inert, on the grounds that transcription needs the dashboard's upload handler. It does not: `MenuImportCommands` already sits inside `AuthProvider`, so it can build the upload from `getMusicClient()` and `getToken`, and `openProjectDocument` opens the result as a document — which is the whole of what navigating to the editor would have achieved. Step 4 now wires it, and Step 5 fails the task if any command reaches the menu with no handler.
