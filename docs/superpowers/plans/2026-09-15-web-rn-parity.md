# Web ↔ React Native parity: shared interfaces, no duplicate code

Source: a five-area audit (inspector, score editing, generation/projects,
transport/keyboard/print/pages, app shell/persistence) on 2026-09-15, 154
findings. This plan groups them into waves ordered by package dependency.

Repos: `music_types` → `music_drawing`, `music_editing`, `music_player`,
`music_client` → `music_lib` → `music_app` (web), `music_app_rn` (RN).
Paths below: **W** = `music_app/src`, **R** = `music_app_rn/src`.

## Ground rules for every task

- Never `git commit`, `git push`, `git checkout`, `git stash`, `git restore` or
  `git reset` in any repo. Leave work in the working tree.
- Stay inside the repos your task names. Other agents are editing other repos at
  the same time.
- Test-first where there is logic. Every new shared function gets tests in its
  package. Verify a new test fails without the change.
- After changing a library: run its `verify` (or `typecheck`, `lint`, `test`,
  `build`), then sync `dist` into consumers:
  `rsync -a --delete <lib>/dist/ <app>/node_modules/@sudobility/<lib>/dist/` for
  `music_app`, `music_app_rn` and any `music_*` repo that has a nested copy.
  Run `rm -rf music_app/node_modules/.vite` afterwards.
- Match the surrounding style: long comments that explain _why_, closed
  vocabularies as `as const` arrays, `Record` keyed by vocabulary (never
  parallel arrays), labels as i18n keys (libraries hold no strings).
- Read the package's `CLAUDE.md` before editing it. Respect
  `__architecture.test.ts` and `__single-source.test.ts` guards.

## Product decisions (from the user)

1. **Documents.** RN keeps local `.moo` files and server projects. Both run on
   music_lib's project store and autosave; a local document is a no-server
   store whose save writes the file. Web gains opening/saving `.moo`.
2. **Import.** Signed in → new server project (both apps). Signed out or
   offline on RN → local document.
3. **Generate.** Web's model on both: remove RN's in-editor Generate Score; add
   Generate Again (locked choices) to RN.
4. **Rules.**
   - Insert Note advances the caret on both.
   - Note-tab fields are disabled during playback on both.
   - Export keeps the title in the filename on both (reserved characters
     replaced); no ASCII slugging.
   - The keyboard starts expanded on both and remembers collapsed state as a
     device pref.
5. Everything else: **web's behaviour is the reference** unless a finding says
   web is the buggy side.

---

## Where shared code goes (by responsibility)

| Package         | Owns                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `music_types`   | the model, Zod schemas, pure primitives both frontend and backend need (pitch/tick math, vocabularies, picker options, readout formatting). No dependencies, hooks or async.                                                               |
| `music_codecs`  | every score file format that carries notes: MIDI, MusicXML, tracker modules, **and the app's own `.moo` project file**. Filenames written for those formats.                                                                               |
| `music_io`      | files and audio: the open/save layer, audio formats (wav/mp3 import extensions, MIME), filesystem, XML parsing, MIDI input.                                                                                                                |
| `music_player`  | everything that makes sound: transport, engines, plans, offline rendering.                                                                                                                                                                 |
| `music_client`  | the network: `MusicClient`, react-query hooks, generation job and snapshot hooks.                                                                                                                                                          |
| `music_drawing` | canvas and keyboard geometry, the score canvas interface, print layout, render themes.                                                                                                                                                     |
| `music_editing` | the editing store and every operation that changes a score; shared app content (docs, shortcuts, formats, resource links).                                                                                                                 |
| `music_lib`     | frontend business logic above editing: composed app store, per-document stores, autosave, playback adapter, generation request builders and drafts, credits, device prefs, host copy wiring. Re-exports `music_types` and `music_editing`. |

Apps (`music_app`, `music_app_rn`) hold UI and platform wiring only.

## v2 corrections (2026-09-15 review)

Wave 1A placed some modules in `music_types` that belong elsewhere:

- `domain/documents/project-file.ts` (`serializeProjectFile`, `parseProjectFile`,
  `ProjectFileError`, `DOCUMENT_EXTENSION(S)`, `PROJECT_FILE_VERSION`) →
  **music_codecs**.
- `domain/documents/file-names.ts` (`exportFilename`, `importedTitle`) →
  **music_codecs**, replacing its two `safeFilename` implementations
  (`midi/export.ts`, `musicxml/export.ts`) with the keep-the-title rule.
- `domain/documents/audio-import.ts` (`AUDIO_IMPORT_EXTENSIONS`, `AUDIO_MIME`,
  `audioMimeFor`, `isLongAudio`) → **music_io**.
- `domain/generation/credits.ts` (`isOutOfCredits`) → **music_lib**, beside the
  credit estimates.
- `EDIT_MODE_OPTIONS` (in `domain/notation/toolbar-icons.ts`) → **music_editing**,
  which owns `EditMode`.

Issues found in review, to fix in the waves below:

- Refusal toasts (range, polyphony) are English strings built in music_editing.
- A paste refused after a cut leaves the notes only in undo history: the toast
  needs an Undo action.
- Out-of-range **black** keys look normal; dim them
  (`KEYBOARD_OUT_OF_RANGE_BLACK` in music_drawing).
- Dark theme: `noteOutOfRange` `#fb923c` is close to `noteRegenerated`
  `#d9a066`; use a more saturated orange (`#f97316`).
- (2C) macOS plays through native libfluidsynth but exports audio through the
  MP3 sample packs, so an export is not a recording of what was heard. Render
  offline through the same native synth (fluidsynth fast render) behind
  `renderScoreAudio`'s RN variant.
- (2C) Audition arguments rebuilt in both apps: add
  `auditionVoiceFor(track) → { program, isPercussion }` (music_types, beside
  `isPercussionTrack`) and use it in both keyboards.
- (2C) RN `SoundfontOptions` restates `RNMusicPlayerOptions`; use a `Pick<>`.

## Wave 1 (parallel)

### 1A. `music_types`: pure helpers (repo: music_types only)

Add, with tests, exported from the index:

- `formatTimecode(seconds)` — web W `components/transport/TransportBar.tsx:97`, RN
  identical.
- `PLAYBACK_SPEEDS` (`as const`).
- `transportExtent(score) → { maxTick, totalSeconds }` using `scoreEndTick` over
  all tracks, floor 1 (web rule).
- `synthLoadPercent(load)`.
- `tempoAtBar(score, measure) → { bpm, ownEventId | null, isStarting }`.
- `MIN_BPM`/`MAX_BPM` exist in `domain/validation/limits.ts`: add
  `clampBpm(n)` (round + clamp).
- `parseNumericDraft(text, { min, max, integer }) → number | null` (empty →
  null).
- `MIN_OCTAVE`/`MAX_OCTAVE` from MIDI 0–127.
- `TIME_SIG_DENOMINATOR_OPTIONS` (1,2,4,8,16,32) and `MAX_TIME_SIG_NUMERATOR`.
- `pickupBeatOptions(measure, ppq) → { current, beats[] }` — W
  `components/inspector/measure-fields.tsx:105-129`, R
  `features/inspector/MeasureTab.tsx:111-113, 279-295`.
- `parseEndingNumbers(text)` / `formatEndingNumbers(nums)`.
- Picker sentinels module `domain/notation/picker-options.ts`: `CUSTOM_DURATION`,
  `NO_DYNAMIC` (reuse `NO_MARK` if equivalent), `INHERIT_CLEF`, `NO_PICKUP`,
  `SINGLE_BARLINE`, `NO_JUMP` — W `components/inspector/shared.ts:79-107`.
- `BARLINE_OPTIONS` (PickerOption with `labelKey`, single first).
- `KEY_MODE_OPTIONS` with `labelKey`; make `keySignatureOptions` return tonic
  and count separately so apps translate.
- `durationFieldState(notes, ppq) → { kind: 'name'|'custom'|'mixed', name?, ticks? }`.
- `volumeReadout(v)`, `clampVolume`, `clampPan`, `MIX_STEP` / `quantizeMix`.
- `formatBeatForField(beat)` (2-decimal rounding, web rule).
- Instrument menus: `GENERATION_INSTRUMENT_GROUPS` (voices, kits, GM families,
  web order) and `generationInstrumentOptionsFlat({ voices })` — replaces R
  `features/generation/ScoreSetupFields.tsx:70-83` and R
  `features/generation/GenerateTrackSheet.tsx:31-39` and web
  `features/instruments/InstrumentSelectItems.tsx` data.
- `instrumentPickerFor(track) → { options, value, titleKey }`.
- `DURATION_ICON: Record<BaseDuration, NotationIconName>`,
  `ACCIDENTAL_ICON: Record<Accidental, NotationIconName>`, `EDIT_MODE_OPTIONS`.
- `exportFilename(title, extension)` — keep the title, replace reserved chars,
  `Untitled` fallback (R `documents/export.ts:64-70` rule).
- Project file: `serializeProjectFile({ title, score })` →
  `{ version: 1, title, score }`; `parseProjectFile(text)` accepts that **and**
  web's `{ name, schemaVersion, score }` (R `documents/document-file.ts:33-86`,
  W `components/layout/AppLayout.tsx:507`, W
  `features/projects/DashboardPage.tsx:408`). Export `DOCUMENT_EXTENSION = 'moo'`,
  `DOCUMENT_EXTENSIONS = ['moo', 'moosiac', 'json']`.
- `importedTitle(score, fileName)` — score title first, else file name without
  extension.
- `AUDIO_IMPORT_EXTENSIONS`, `AUDIO_MIME`, `isLongAudio(bytes)`.
- `publishedSnapshotUrl(webOrigin, lang, publicId)`.
- `communityItemTitle(item)`, `communityListState(items, query, failed)`.
- `gmInstrumentRows(query)` (formatted cells incl. range via existing note
  naming, polyphony, transposition, basis key).
- `isOutOfCredits(balance, siteAdmin)`.
- `resolveThemeMode(mode, systemIsDark)` if `THEME_MODES` lives here; otherwise
  leave for 2B.

Do **not** touch the apps.

### 1B. `music_client` (repo: music_client only)

- `MusicHookContext` takes `getToken: () => Promise<string | null>` instead of a
  captured `token` (keep a compatibility path if many call sites break, but the
  apps will move to `getToken`). Hooks read the token per request.
- `useSiteAdmin(ctx)` (closed default `false`).
- `classifyGenerationError(err) → 'paywall' | 'error'` and
  `isInsufficientCredits(err)`.
- `createGeneratedProject(client, token, submission, { variant? })` — create,
  start job, delete the project if refused, `'Generated score'` name fallback.
  From W `features/projects/DashboardPage.tsx:227-253` and R
  `features/projects/create-server-project.ts:18-55`.
- `useProjects(ctx, query, { pollWhileGenerating })` using exported
  `GENERATION_POLL_MS`.
- `useDuplicateProject`, `useCancelProjectGeneration` (alongside
  `useDeleteProject`).
- `useProjectSnapshots(ctx, projectId, { flush, onAdopt, noteServerVersion })`:
  list + status → `snapshotTree`, create (flush first, then
  `noteServerVersion(status.updatedAt)` — no full reload), publish, rename
  (republish), unpublish, open (adopt score, keep history,
  `noteServerVersion`), default publisher name from `lastPublisherName`.
  From W `components/layout/AppLayout.tsx:245-341` and R
  `features/snapshots/SnapshotsPanel.tsx:72-261`. `suggestedPublicName` =
  web's rule (`projectName name`), refuse blank public title.
- `useTranscriptionCapability(ctx)`.
- `useProjectGeneration`: accept `getServerUpdatedAt` (so a non-music_lib store
  can supply the stamp) if still needed after wave 2.

### 1C. RN app bug fixes that need no library change (repo: music_app_rn only)

- `auth/AuthContext.tsx:117-144`: add `siteAdmin` to the memo deps.
- Hidden tracks: pass `trackIds: selectVisibleTrackIds(state)` into
  `canvas.setView` (R `features/score/ScrollingScore.tsx`); use
  `selectVisibleTrackIds` in R `features/score-editor/TrackVisibilitySelect.tsx`
  and hide it with fewer than 2 tracks.
- Out-of-range marking: `canvas.setOutOfRangeNotes(outOfRangeNoteIds(score).ids)`.
- Caret colour from `LIGHT/DARK_RENDER_THEME.caret` (R
  `features/score/PlaybackCursor.tsx`, `.macos.tsx`).
- `TrackTab.tsx:288`: subscribe to `canDeleteTrack`.
- Delete the unused toolbar `useClipboardPrompts` (R
  `features/score-editor/EditorToolbar.tsx:199, 808`).
- Delete dead tap timing in R `features/piano-keyboard/PianoKeyboard.tsx:73-92`.
- `barCount(score)` instead of counting `tracks[0].measures`.
- Insert Note: keep `advanceCaret: true` (decision 4); nothing to change on RN.
- Dashboard New Project: catch errors; 402 → paywall sheet; ≤0 gate
  (`R/screens/DashboardScreen.tsx:99-120`, `MenuFileCommands.tsx:159-172`).
- Audio transcription: catch upload errors (`DashboardScreen.tsx:130-145`,
  `features/documents/ImportButtons.tsx:87-96`).

---

## Wave 2 (after 1A; parallel across repos)

### 2A. `music_drawing`

- `classifyPress({ dx, dy, heldMs }) → 'tap' | 'longPress' | 'drag'` with shared
  `TAP_SLOP` (3px, web) and `LONG_PRESS_MS` (500) / long-press slop.
- **Already done (2026-09-15, out-of-range work):** `trackKeyboardSpan(track) → { range, playable }`
  (compass widened to the track's notes, reaching past A0/C8), `PianoKey.outOfRange`
  via `computeKeys(..., playable)`, `KEYBOARD_OUT_OF_RANGE_WHITE`, and orange
  `noteOutOfRange` in every screen theme. Both apps already use them.
  `keyboardKeys` below must build on `trackKeyboardSpan`, not replace it.
- `keyboardKeys({ width, height, track, pitchDisplay }) → { range, naming, keys, labelGutter }`
  folding range, naming, written-pitch relabel, percussion label rows and width
  (web rules; web's width bug: pass the range).
- `printPlan(score, { scope: 'score' | trackId, visibleTrackIds, paper, orientation })`
  merging R `features/print/print-plan.ts` with web's rules (extractPart for a
  part, rehearsal marks, `displayScore`, page turns only for a single part,
  default scope = visible tracks, drop empty pages).
- `PAPER_OPTIONS`, `ORIENTATION_OPTIONS` (label keys, CSS keyword).
- Keyboard colour tokens on the render theme.
- `ScoreCanvas.setScore` computes out-of-range ids itself (so no app can forget)
  given the stored score — or add a `setStoredScore`.

### 2B. `music_editing`

- **Already done (2026-09-15):** `services/editing/range-refusal.ts` —
  `outOfRangeReason`, `refuseOutOfRange`, `refuseOutOfRangeTranspose` (allows
  moving toward the range), `refuseOutOfRangeArrival`; wired into transpose
  (semitone/octave), `relocateNotes` and note paste, alongside the existing
  entry, pitch-change and pitch-drag refusals. Reuse these; do not add another.

- Inspector: `commitBarTempo(store, measure, text)` (uses `tempoAtBar`, passes
  the event id, rounds/clamps, skips no-op), `setClefAtMeasure(store, measureId, clef | undefined)`
  (works out the track), `measureClefOptions(track, index)`.
- `setScoreMetadata` and `renameTrack` skip no-op (trimmed) patches and return
  `boolean`.
- `setFingering` trims; chord symbol and fingering fields shown for exactly one
  note (web rule).
- `changeVelocity` clamps and rounds; `setNotePitch` enforces octave bounds;
  `setTimeSignature` validates denominators and numerator max; `setTrackMix`
  quantizes.
- `selectEditLocked(state)` plus a documented set of mix-only controls; Note tab
  disabled while playing (decision 4).
- `INSPECTOR_TABS` (web order: Score, Track, Note, Bar) and
  `defaultInspectorTab(selection)`.
- `canReplace(state, scope)`.
- Track-slice actions pick undo labels from `commandLabel` themselves.
- Routing: `routeScorePress(store, hit, { shift, mod, noteInput, pitchDisplay, anchor }) → nextAnchor`
  (web order and modifier semantics); `selectForContextMenu(store, hit, anchor)`
  (keep a selection the press lands inside);
  `classifyPointerDown(state, hit, { alt })` and
  `applyBoxSelection(store, ids, additive)`. Option-drag selects the chord via
  `selectNotes`.
- Context menu: `scoreContextMenuModel({ selection, clipboard, playing })` and
  `runScoreContextAction(store, action, prompts)` plus the shared
  `ScoreContextAction` type.
- Toolbar: `selectToolbarAvailability(state) → Record<ToolbarControl, boolean>`
  (web rules; Enter Lyrics, add/delete bar, glissando also locked while
  playing), `selectEffectiveEditMode`, `editModeHintKey`, `EDITOR_VOICE_COUNT`,
  `quantizeSelectionToGrid(store, grid)`, `insertDefaultNoteAtCaret(store)`
  (advances caret), `goToBarFromInput(store, text)`, `addTrackChoices`,
  `trackPickerVisible(state)`.
- Shortcuts: digits and `.` call `chooseDuration`; apply toolbar availability.
- Lyrics: `beginLyricEntry(store)`, pure `lyricEntryStep(state, input, draft)`
  and `splitLyricSeparator(text)` (web semantics: Tab advances, `-` anywhere,
  trim, Escape cancels).
- Transport binder: `bindPlayer(player, store)` — store-generic core of
  music_lib's `PlaybackAdapter` (transport-state mirroring, visible-track push,
  clear selection on play, error hook, loop rule: selection else whole score,
  measure stepping, speed/volume/metronome in the store).
- `openingTempoBpm(score)`, `commitOpeningTempoText(store, text)`.
- `litKeys(sounding, activeTrackId, transportState, held)`.
- `resolveThemeMode(mode, systemIsDark)`; `shortcutGroupLabelKey`,
  `docsGroupLabelKey`.
- `WRITABLE_EXPORT_FORMATS` (id, extension, label key) that the docs formats
  table derives from; `planExport(store, format, scope)`.
- `repairIssuesOutcome(result) → messageKey`.
- `decideClose`/`decideQuit` (from R `documents/unsaved-guard.ts`).

### 2C. `music_player`

- `renderScoreAudio(score, soundfont) → { samples, sampleRate }`.

---

## Wave 3 (after wave 2)

### 3A. `music_lib`

- New Project draft reducer `services/generation/new-project-draft.ts`
  (web `features/projects/NewProjectDialog.tsx:297-690` is the reference):
  `initialDraft()`, actions `applyStyle` (random style tempo and key, bars
  recomputed), `setGenerating` (auto vocal tracked by entry id),
  add/remove/replace instrument (essential rows locked by tier), `setBars`,
  `setTempo`, `setMeter`, `setDuration`, variant; selectors `isLocked`,
  `defaultTitleKey`, `tempoRefused`, `showDuration` (hidden while writing
  lyrics), `canCreate`, `toSubmission`. Default bars
  `DEFAULT_GENERATE_SCORE_MEASURES`.
- `labelledOptions(values, t, locale, noneLabel)` for style/mood.
- Replace: `REPLACE_PRESET_INSTRUCTIONS`, `defaultReplaceSubmission()`,
  `buildReplaceSubmission(draft)` (web values).
- `regenerateWithLocks(record, lockedKeys)` and `LOCKABLE`.
- MIDI import: `patchMidiImportOptions(opts, patch)`, `canImportMidi(opts)`
  (≥1 track; web rules for clamps, fix the split-point `|| 60` bug).
- `createLibraryCopy(t)` → editing, selection, MusicXML warnings, library,
  templates — every entry a function (fixes startup-language capture).
  **Include the editing refusals**, which music_editing still builds as English
  sentences: `range-refusal.ts` (`outOfRangeReason` + each route's tail: "not
  added / changed / moved / transposed / pasted", "the accidental was not
  changed") and the polyphony refusal in `insertChordAtCaret`. Add
  `EditingCopy` entries taking `{ pitch, instrument, compass, direction }`,
  translate in both apps.
- Device prefs: validated `DevicePrefs` (theme, developer mode, pitch display,
  keyboard collapsed — default expanded, font size, language) with `PREFS_KEY`,
  `loadPrefs`/`savePrefs` over an injected storage, and
  `bindDevicePrefs(store, storage)`.
- Documents on the shared store: a store per document for both origins —
  project (server autosave as today: debounce, in-flight guard, score omission,
  `uiPrefs`, `lastGeneration`, `serverUpdatedAt`, `saveState`) and local file
  (same autosaver, save writes `serializeProjectFile` through an injected file
  storage). Dirty is cleared only if the score saved is still the current one.
  `adoptOutsideScore(store, score, player)` (stop first).
- `hostCanvasScheduler` and host playback-binding defaults, if music_lib is
  allowed to read host globals lazily (otherwise keep in apps).
- Toast sink injected through the store context so RN can render errors.

### Wave 3 review (2026-09-15) — done, with fixes

Verified from a clean rebuild in dependency order (music_types 1183, music_editing
419, music_lib 299 tests) and against both apps (web 784, RN 134 vitest + 305 jest).
The exported names differ from the short names above; use these:

- New Project: `initialNewProjectDraft`, `reduceNewProjectDraft(draft, action, rng?)`,
  `isNewProjectEntryLocked`, `canRemoveNewProjectEntry`, `newProjectDefaultTitleKey`,
  `newProjectTempoRefused`, `newProjectDurationRefused`, `showNewProjectDuration`,
  `showNewProjectLyrics`, `showNewProjectLyricsTheme`, `newProjectRequestDraft`,
  `newProjectCreditEstimate`, `canCreateNewProject(draft, { submitting, outOfCredits })`,
  `newProjectSubmission(draft, defaultTitle)`, `DEFAULT_GENERATION_VARIANT`.
- Pickers: `labelledOptions(values, label, locale?, noneLabel?)`, `styleLabelKey`,
  `moodLabelKey`, `complexityLabelKey`, `optionalToPicker`/`optionalFromPicker`.
- Replace: **`REPLACE_PRESET_KEYS` + `replacePresetLabelKey(key)`** (locale
  `replace.preset.<key>`; the English for each key is in the doc comment — add en and
  zh to both apps), `defaultReplaceSubmission`, `buildReplaceSubmission`.
- Generate Again: `LOCKABLE`, `lockableChoiceValue`, `lockableChoiceRows`,
  `generationChoiceLabelKey`, `regenerateWithLocks(record, lockedKeys)`,
  `regenerateCreditEstimate`.
- MIDI import: `patchMidiImportOptions(opts, patch)` — the number fields take
  **`parseNumericDraft(text)`** (null = cleared), never `Number(text)`; `canImportMidi`.
- Credits: `isOutOfCredits` is music_lib's now.
- Documents: `createDocumentStore`, `openProjectDocument`, `openFileDocument`,
  `adoptOutsideScore`, `DocumentFileStorage`, `DocumentOrigin`; saving via
  `createDocumentSaver`/`projectWrite`. **Opening does not move the shared caret**
  (`resetPosition`, default false): the host restores each tab's caret when it comes
  to the front.
- Prefs: `DevicePrefs`, `PREFS_KEY`, `loadPrefs`/`savePrefs`, `bindDevicePrefs`,
  `createDevicePrefsStore`, and **`mirrorDevicePrefs(prefsStore, documentStore)`** —
  RN keeps prefs in one store and mirrors theme, developer mode and pitch display
  into every open document store.
- Toasts: `StoreContext.toasts` (`ToastSink`).
- Copy: `createLibraryCopy(t)` + `installLibraryCopy`. Undo labels now have a
  runtime list, `COMMAND_LABEL_KEYS` (music_editing).
- `EDIT_MODE_OPTIONS` lives in music_editing's ui slice.
- `SetScoreOptions.resetPosition` (music_editing).

Found and fixed in review:

- Undo history printed raw keys: the web locale lacked 11 `command.*` labels, RN
  lacked 45 (RN's `keys-exist.test.ts` exempted `command.*` as "checked upstream";
  nothing was). All 49 are in both apps, worded alike, and each app has a guard
  over `COMMAND_LABEL_KEYS`.
- Opening a document reset the front document's caret (see `resetPosition`).
- A cleared MIDI split-point field would have become MIDI 0.
- Replace presets were English sentences in the library.

Decisions on the agents' open questions (web is the reference):

- RN's New Project gains `variant: 'deepseek'`; RN's Replace defaults become the
  web's (nothing preserved, moderate). Accepted.
- An edit landing mid-save now leaves the web project `unsaved` (it was marked
  clean). Intended.
- `syncToServer` may send one extra metadata PUT if a file save was pending. Accepted.
- Replace sends the style token rather than the preset phrase, as the web does. Left.
- RN needs `generateScore.complexityName.*` before using `complexityLabelKey`.
- `caretToBar`: remove from music_editing once both apps use `goToBarFromInput` (wave 5).
- From 2B: Option-drag must only change the selection (web), and a cmd-click on
  empty stave uses the canvas's `tickAt` (web) — fix `routeScorePress` /
  `classifyPointerDown` in music_editing during 4A. Replace is locked while playing on
  both. The issues list stays open when nothing was fixed (web). Project export
  writes `.moo`.

---

## Wave 4 (after wave 3): adopt in the apps

### 4A. Web (`music_app` only)

Adopt every shared function above and delete the local copies. Web-side fixes:
bar heading via `barNumberAt`; dynamic/articulation pickers use `NO_MARK` /
`DYNAMIC_OPTIONS`; quantize grid list from music_editing; MIDI wizard option
lists from music_types; dashboard list via music_client hooks; drop dead
Generate Track try/catch; published page uses its own player binding (bug:
plays the singleton store) and `publishedSnapshotUrl`; print uses
`printPlan` (adds `displayScore`); keyboard via `keyboardKeys` (width bug);
export filenames keep titles; open/save `.moo`; i18n: synth-load copy keys,
`transport.play/pause`, volume label, key-mode labels; theme listener also
updates canvas colours when the OS flips in system mode; Insert Note advances
the caret; Note tab disabled while playing.

### 4B. RN (`music_app_rn` only)

Move documents onto music_lib's per-document store (both origins) and delete
`documents/autosave.ts`, `project-sync.ts` save paths, `unsaved-guard.ts` (use
music_editing's), the ad-hoc stamp; `EditorScreen` save/flush by origin through
the store; `useTransport` → `bindPlayer`; adopt every shared helper and delete
local copies; `getToken` hook context; `useSiteAdmin`; `useProjectSnapshots`;
`createGeneratedProject`; New Project via the draft reducer; Replace defaults;
remove in-editor Generate Score and add Generate Again; import creates a server
project when signed in; render toasts; device prefs (theme, language, pitch
display, developer mode, keyboard collapsed default expanded); tab close uses
the guard; flush on background; routing/context menu/toolbar/lyrics via
music_editing; tap-vs-scroll via `classifyPress`; long press keeps the
selection; inspector via the commit helpers (draft number input committing on
blur, Mixed placeholders, tabs order and default tab); print via `printPlan`
with paper/orientation; keyboard via `keyboardKeys` and `litKeys`; published
share URL; docs/community via shared rows; project file via
`parseProjectFile` (reads web exports).

### Wave 4 review (2026-09-15) — done, with fixes

Verified: music_editing 426, music_lib 300, web 826, RN 107 vitest + 359 jest; the
Mac app driven live (open by link, play, lock while playing, switch tabs mid-play,
Insert Note, autosave to the `.moo`, keyboard pref across a relaunch).

Found and fixed in review:

- **A binding could play another binding's score.** The published page (both apps)
  loads the shared player while the editor's binding stays alive; the editor saw no
  score change and Play played the published piece. `bindPlayer` now records which
  score each player last loaded, reloads its own before playing, and mirrors the
  transport and hidden tracks only while its score is the loaded one.
- **Unbinding left music playing** under a screen that no longer showed it:
  `unbind` pauses playback it owns.
- **Switching RN tabs mid-playback** kept playing, left the old store locked as
  "playing", and would have reported the pause over the restored caret.
  `DocumentList` takes `leaveFront(document)`, called before the caret is banked;
  the app pauses there if that document is playing.
- **The RN playback cursor ran over the keyboard** (visible once the keyboard
  started expanded): the pinned overlay now clips.
- **RN document tabs were invisible to assistive technology** (no label, no
  accessibility action): fixed, with a test.

### Wave 5: guards and loose ends

From the wave 4 agents and review, to do here:

- Project file extension: `WRITABLE_EXPORT_FORMATS` and the docs `EXPORT_FORMATS` /
  `IMPORT_FORMATS` still say `json`; both apps override to `.moo` by hand.
- `insertNoteAtCaret` and `paste` read the stored edit mode; use
  `selectEffectiveEditMode` in the library and delete both apps' write-back effect.
- `changeVelocity`, `setFingering`, `setNotePitch` return `void`; decide on boolean
  returns or drop the plan item.
- `DYNAMIC_OPTIONS` asks for `dynamic.<member>` keys neither app defines.
- `auditionVoiceFor(track)` does not exist; both keyboards pass program and
  percussion inline.
- Web: `store.language` is persisted but never applied (language comes from the URL).
- Web editor has no way to open a `.moo` (imports live on the dashboard).
- RN: a tab brought back to the front opens scrolled to the top, even when its
  restored caret is off screen. Scroll to the caret (or keep the offset per tab).
- RN: no File-menu item for project export (the macOS menu is native).
- RN: the Note tab's bar/beat field is read-only and the Track tab lacks the
  out-of-range count, both of which the web has.
- music_codecs still exports the `safeFilename` aliases; remove once unused.
- Remove `caretToBar` from music_editing (no callers remain).
- The published page's `setScore` moves the shared caret to 0 (the editor's caret
  is lost by visiting a published link).

Guards:

- `cross-app-parity.test.ts`: also fail when the same English lives under
  different keys in the two apps; rename to one key set.
- Update both `CLAUDE.md` files for moved modules.
