# New Project modal, merged Import, and the macOS File menu

Date: 2026-09-07
Repos: `music_types`, `music_lib`, `music_app`, `music_app_rn` (incl. its macOS target)

## The problem

The web dashboard's toolbar has grown to nine controls: a title, a search
field, a sort picker, **New Project**, **Generate Score**, and five separate
import buttons. Two of those are the same decision asked twice — starting a
project with AI and starting one without it differ only in whether a prompt is
sent — and five of them are one decision (which file) spread across five
controls that differ by a word.

`music_app_rn` has the same shape in miniature: four import buttons on the
dashboard, no New Project at all, and a macOS File menu whose New, Open, Save
and Save As have been greyed out since the app was generated, because nothing
in the responder chain implements `newDocument:`, `openDocument:`,
`saveDocument:` or `saveDocumentAs:`.

## What we are building

1. **One New Project modal** in both apps, carrying a **Generate for me**
   toggle. On, it is today's "Generate a new score" form. Off, the AI fields
   are hidden and it creates a blank project with the chosen instrumentation
   and settings. Its actions are **Create** / **Cancel**.
2. **One Import control** in place of the import buttons, in both apps.
3. **A working macOS File menu**: New, Open, Save, Save As, and an Import
   submenu that gains Audio.

## Section 1 — the shared library

### 1.1 `buildNewProjectScore` (music_lib)

A blank score built from an instrumentation is a fact about the _product_, not
about either app's panel, and two apps now need it. It goes beside its
generating twin in `music_lib/src/services/generation/request.ts`:

```ts
/** The half of a New Project draft that does not involve the model. */
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
```

`GenerateScoreRequestDraft` is structurally assignable to `NewProjectDraft` —
it has every one of these fields plus `prompt`, `style`, `mood` and
`complexity`. That is the point: **one form state feeds both builders**, and
the toggle decides only which is called. A second draft type per mode would be
two shapes to keep in step for no gain.

Validation is `buildGenerateScoreRequest`'s minus the prompt:

- `durationMeasures` a positive integer,
- at least one instrument,
- `tempoText` blank (omit the tempo) or a positive number; anything else is a
  refusal, exactly as the generating path treats it.

Failing returns `null`, so `canBuildNewProjectScore` is `!== null` and the two
modes disable Create by the same rule.

The score is `createEmptyScore` over
`instrumentValues.map(generateScoreTrackForInstrumentValue)`, which carries
**`midiProgram`** as well as `instrumentName` and `clef` — so a String Quartet
produces four strings rather than four pianos. The title falls back to
`"Untitled"` the way `emptyScoreForRequest` does.

### 1.2 `emptyScoreForRequest` drops `midiProgram` (music_types)

`emptyScoreForRequest` in
`music_types/src/domain/generation/replacement-region.ts` builds its
placeholder tracks from `{name, instrumentName, clef}` only.
`createTrack` then defaults `midiProgram` to 0, so **every generating
project's placeholder is all pianos** regardless of what was asked for. It is
invisible because the job's result overwrites it minutes later.

`GenerateScoreRequestTrack` already carries `midiProgram`; passing it through
is one line. It is fixed here rather than later because §1.1 states the same
fact — "the score an instrumentation implies" — and two statements of it that
disagree is how the new one comes to be wrong.

A test pins that a request naming a violin yields a track whose `midiProgram`
is the violin's, not 0.

### 1.3 Release order

Both packages need `bun run clean && bun run build` (build alone does not clean
`dist`), then an rsync into `music_app/node_modules` and
`music_app_rn/node_modules`, then `rm -rf music_app/node_modules/.vite` — Vite
serves the pre-bundled copy otherwise and the browser runs the old code while
the file on disk is right. They must be **published before either app is**, or
a consumer pins whatever npm serves at that moment.

## Section 2 — the web New Project modal

`src/features/generation/GenerateScoreDialog.tsx` moves to
`src/features/projects/NewProjectDialog.tsx`, with its test. It was
dashboard-only already — the editor sidebar gave up whole-score generation when
generation became a server-side job — so nothing else imports it, and the
folder now matches what it makes.

### 2.1 The toggle

Directly under the Title field, a `Switch` from `@sudobility/components`
(`checked` / `onCheckedChange`, `role="switch"`, named by
`newProject.generateForMe`), defaulting to **off**.

Off hides, in one block:

- Prompt and the Presets menu
- Style, Mood, Complexity, Model
- the credit estimate and the out-of-credits line

Instrumentation and everything below it — Bars, Tempo, Key, Mode, Time
signature — stay in both modes.

**Known cost, accepted:** the Style picker also _fills_ the form —
`applyStyle` sets the ensemble, tempo, bar count, meter and mode from
`GENERATE_SCORE_STYLE_PRESETS`, which is the fastest way to start a country
project whether or not a model writes the notes. Hiding Style with the rest of
the AI block takes that away from blank projects. This is what the requirement
asks for and it keeps the rule legible ("everything above Instrumentation is
the AI half"); a Style picker that survived the toggle would be the one
exception a reader has to learn.

State is not reset when the toggle flips. A reader who fills in a prompt,
turns the toggle off and turns it back on gets their prompt back, because
losing typed text to a toggle is the kind of thing that is never worth the
tidiness.

### 2.2 What it emits

```ts
export type NewProjectSubmission =
  | { kind: 'generate'; request: GenerateScoreRequest }
  | { kind: 'blank'; title: string; score: Score };
```

A discriminated result rather than a request, because the same modal has to
serve a server project on the web dashboard, a server project on the RN
dashboard, and a **local document** from the macOS File menu. The modal decides
what was asked for; the caller decides where it lands.

**The Title field feeds two different things, and they have different
fallbacks.** `metadata.title` is what the piece is called and is what every
exported file is named after; `project.name` is what the row it is stored in
is called. Typed, one word fills both. Left blank, the score gets `"Untitled"`
from `buildNewProjectScore` (§1.1, matching `emptyScoreForRequest`) and the
project row gets the localised `"Untitled Project"`, because a row in a list
of rows needs a name a reader can tell from the others and a score's own title
does not. So `title` on the blank branch is the trimmed field or
`newProject.untitled`, while the score inside it may say `"Untitled"`.

### 2.3 Actions

`Cancel` / `Create` via `FormModal`'s `actions`, Create last and therefore
primary, disabled by `canBuildNewProjectScore` or
`canBuildGenerateScoreRequest` according to the toggle, and by `outOfCredits`
**only in generate mode** — a blank project costs nothing and must not be
refused for want of credits.

Requirement §4 ("full screen on mobile, sticky action buttons") needs no work:
`FormModal` is already full-screen below `sm` with a sticky bottom bar, and
every modal in this repo is a `FormModal`. `closeAriaLabel` stays set, because
a footer with a Cancel and a top-bar × both named "Cancel" is ambiguous aloud
and a strict-mode failure in tests.

## Section 3 — the web dashboard

### 3.1 The toolbar

```
Moosiac ─────────── [Search projects] [Import ▾] [New Project] [Last modified ▾]
```

The heading keeps `flex-1`; the four controls follow it. Every one of them
keeps `ROW_CONTROL_CLASS`, which is what makes a row of controls that size
themselves from their own content come out level.

Removed: the inline "New project name" field and its Create button, the
Generate Score button and its tooltip, and all five import buttons.

The empty state's "Start your first project" opens the modal instead of the
inline field. Its label stays distinct from the toolbar's "New Project" —
Playwright matches accessible names by substring, and two controls sharing a
name are ambiguous read aloud.

### 3.2 The Import select

One `Select` whose items are MIDI, MusicXML, Audio, Module and Project JSON.

It is **controlled at `value=""`**: Radix renders `SelectValue`'s placeholder
for an empty root value, so the trigger keeps reading "Import" rather than
becoming "MusicXML" after one use, and `onValueChange` fires on every
selection because a controlled Radix Select never adopts the value itself.
That is what turns a Select into a menu without hand-building one. (The
hand-built `role="menu"` popover used by the Presets button and the editor
toolbar is the fallback if this misbehaves; a test pins that choosing the same
item twice opens the dialog twice.)

Each item opens exactly the dialog its button opened — `MidiImportWizard`,
`MusicXmlImportDialog`, `AudioImportDialog`, and the two `FileImportModal`s
for Module and Project JSON. Audio keeps its capability probe on open. None of
those components change.

### 3.3 Creating

- `kind: 'blank'` → `store.getState().newProject({ name: title, score })`,
  `playbackController.stop()`, navigate to `/project/:id`.
- `kind: 'generate'` → the existing `startWholeScoreGeneration`, unchanged,
  including its rule that a refused job **deletes the project it just
  created** so a user with no credits does not collect empty "Generated score"
  rows.

### 3.4 Copy

New keys, in `en` **and** `zh` with real Chinese — `locale-parity.test.ts`
fails on an English string copied across, which is how 42 strings once shipped
untranslated:

| key                            | English                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `newProject.title`             | New Project                                                                 |
| `newProject.generateForMe`     | Generate for me                                                             |
| `newProject.generateForMeHint` | Let AI write the music. Off, you get an empty score with these instruments. |
| `newProject.untitled`          | Untitled Project                                                            |
| `dashboard.import`             | Import                                                                      |
| `dashboard.importFormat`       | Import a file                                                               |

Removed: `dashboard.newProjectName`, `dashboard.generateScore`,
`dashboard.generateScoreHint`, `dashboard.importAudioHint`,
`dashboard.importModuleHint`. `dashboard.importMidi`,
`importMusicXml`, `importAudio`, `importModule` and `importProject` survive as
the menu items' labels (`importProject` is also the JSON modal's title).

`cross-app-parity.test.ts` requires any key both apps carry to have identical
English, so the same table is used verbatim in `music_app_rn`'s locales.

### 3.5 Tests to move

- `DashboardPage.test.tsx`: "offers every kind of import here" and "opens a
  modal for every import" now drive the select; "New Project creates a project
  on the server" now goes through the modal; a new test that a blank project
  is created with the instrumentation chosen.
- `NewProjectDialog.test.tsx`: everything `GenerateScoreDialog.test.tsx`
  asserted, plus — the AI fields are absent when the toggle is off; Create is
  enabled with no prompt when it is off and disabled without one when it is
  on; a blank submission carries the chosen instruments' programs; an
  out-of-credits balance does not disable Create in blank mode.
- e2e: `helpers.ts` (`createProject` and `generateWholeScore` both go through
  the modal; `generateWholeScore` turns the toggle on and presses **Create**),
  `docs.spec.ts`, `credits.spec.ts`, `acceptance.spec.ts`,
  `midi-roundtrip.spec.ts`, `mod-import.spec.ts`, `musicxml-export.spec.ts`.

## Section 4 — React Native

### 4.1 `NewProjectSheet`

The twin of §2, emitting the same `NewProjectSubmission`.

`GenerateScoreSheet`'s body is lifted into a `ScoreSetupFields` component plus
a `useScoreSetupDraft()` hook, both rendered by the two sheets, with the AI
block behind a flag. A second 350-line copy of the same form is two places for
the style presets, the credit estimate and the instrument list to drift.

`GenerateScoreSheet` keeps its own job — generate into the project already
open, from the editor — and its own title and Generate action.

The toggle is `Switch` from `@sudobility/components-rn`, whose API is
`checked`/`onCheckedChange` like the web's.

### 4.2 The dashboard

`DashboardScreen`'s header gains **New Project** and an **Import** `Select`
(MIDI, MusicXML, Module, Audio) replacing `ImportButtons`' four buttons.
`ImportButtons` becomes that menu in place, so the editor's empty state — its
other caller — gets it too. The RN Select takes a `placeholder`, held with no
`value`, which gives the same "stays reading Import" behaviour as the web's.

Project JSON is deliberately **not** in this menu: on native, opening a
document is File → Open and Recent Documents, not an import. (On iOS and
Android that leaves no way to open a `.moosiac` file from the dashboard, which
is the state today; closing that gap is out of scope here.)

New Project on this screen creates a **server project**, mirroring the web
including the delete-on-refusal rule, then navigates to the Editor with its
id. This screen already requires a server and an account and says which is
missing.

### 4.3 File → New creates a local document

From the macOS File menu, New creates a **local unsaved document**
(`newDocument(list, score, title)`), and the Generate for me toggle is
**disabled with an explanation**: generating needs a project row on the server
for the job to write back to.

Deliberately not a server project. The menu handler is mounted above the
navigator — that is what lets an import work from any screen — and there is no
`useNavigation` there to open the result with. The local-document half of this
app is also the signed-out case, which is the ordinary state for a File menu.

### 4.4 Autosave for new documents

`App.tsx` wires the scratch document's `onChanged` to the autosaver inside a
`useMemo`, and nothing else can reach it — so a File→New document would never
autosave. `DocumentsProvider` gains an `onDocumentChanged` prop, exposed as
`useDocumentChanged()`, and File→New passes it to `createDocument`.

Imports have the same gap today. Fixing that is a behaviour change to the
import path and is left alone.

## Section 5 — the macOS menu

### 5.1 The bridge

`MENU_COMMANDS` in `src/app/menu-commands.ts` gains `file.new`, `file.open`,
`file.save`, `file.saveAs` and `import.audio`. `AppDelegate.mm` gains one
selector per command, posting the same notification the existing eight do.
One method per item rather than one action with a tag: in a storyboard the
selector name _is_ the wiring, and a tag is a number that means nothing read
back.

### 5.2 `Main.storyboard`

| Item         | today                    | becomes                               |
| ------------ | ------------------------ | ------------------------------------- |
| New ⌘N       | `newDocument:` (dead)    | `moosiacFileNew:`                     |
| Open… ⌘O     | `openDocument:` (dead)   | `moosiacFileOpen:`                    |
| Save… ⌘S     | `saveDocument:` (dead)   | `moosiacFileSave:`, retitled **Save** |
| Save As… ⇧⌘S | `saveDocumentAs:` (dead) | `moosiacFileSaveAs:`                  |
| Import ▸     | MIDI / MusicXML / Module | + **Audio…**                          |

All four were greyed out because AppKit disables an item whose selector nobody
in the responder chain implements. "Save…" loses its ellipsis: it writes
without asking whenever the document has a file, and an ellipsis promises a
dialog.

"Revert to Saved" stays dead. It is a real command this app does not have, and
inventing one is not part of this work.

### 5.3 `MenuFileCommands`

Mounted beside `MenuImportCommands`, above the navigator, where
`useDocumentList()` and `useActiveDocument()` both resolve. A third listener on
the same event is consistent with what is there: each handler acts on its own
commands and ignores the rest, which is what keeps two of them from both
acting on one menu item.

- **New** → opens `NewProjectSheet` in local mode (§4.3).
- **Open** → `createFilePicker().pickFile(['moosiac'])`, then the existing
  `openDocument(list, storage, uri, onChanged, recordRecent)`. Cancelling
  resolves null and is an ordinary outcome, not a failure to report.
- **Save As** → `pickSaveLocation(documentFilename(title))`, then a new
  `saveDocumentAs(document, storage, uri)` in `document-storage.ts` that writes
  and _then_ `markSaved`s to the new origin — marking it clean before the write
  leaves a document that looks safe to close after a failed save.
- **Save** → writes to `origin.uri` when the document has a file; otherwise
  raises Save As. `saveDocument`'s existing fallback to
  `storage.defaultDirectory()` is what autosave uses and is left alone; the
  menu command is the one place a person is present to be asked.

Failures surface in a `FormModal` the way `ImportFeedback`'s do. A save that
silently did nothing is how work is lost.

### 5.4 The document format

Open, Save and Save As read and write the app's existing `.moosiac` document —
`{version, title, score}`, parsed by `parseDocument`, which refuses a version
from the future rather than reading it hopefully.

**Known asymmetry.** The web's "Export project JSON" writes
`{name, schemaVersion, score}` and its importer reads `{name?, score}`. So a
`.moosiac` file _will_ import into the web — the importer only needs `score`,
and falls back to the score's own title — but a project JSON exported from the
web will **not** open on the Mac, because it carries no `version`. Unifying
the two formats was considered and deferred; if it is wanted, the contained
change is `parseDocument` accepting `schemaVersion`/`name` as aliases.

## Verification

- `music_types` and `music_lib`: their own suites, then `clean && build`,
  rsync into both apps, `rm -rf music_app/node_modules/.vite`.
- `music_app`: `bun run verify` (typecheck, lint, vitest, build).
- `music_app`: the Playwright suite, which needs a local Postgres `music_test`
  and `../music_api`'s dependencies installed. Reported honestly if the
  environment will not cooperate.
- `music_app_rn`: `bun run verify` (format, typecheck, lint, vitest + jest).
- The storyboard and `AppDelegate.mm` can only be checked as XML and as
  Objective-C syntax here. Proving the menu items actually fire needs a full
  Xcode macOS build (40+ minutes, and `-derivedDataPath` must not be passed —
  it discards the warm cache); that is a run for the user.

## Out of scope

- Unifying the web's project JSON with the native document format (§5.4).
- Autosave for imported documents (§4.4).
- "Revert to Saved" (§5.2).
- The Templates section on the web dashboard, which is unchanged.
- `DocumentActions.tsx` in `music_app_rn`, which is dead code reached only by
  its own test.
