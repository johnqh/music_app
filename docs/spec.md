# ScoreSmith — AI-Assisted Sheet Music Composition Application: Full Specification

A production-quality web application that allows users to generate music as standard sheet notation, play it in the browser, manually edit notes, select and regenerate portions of the composition, and import/export MIDI files. A lightweight combination of a notation editor, MIDI sequencer, and AI music-generation tool. Complete, runnable TypeScript application with clean architecture, polished UI, tests, documentation, and realistic sample data.

## 1. Product Overview

Core capabilities:

1. Generate a musical composition from a natural-language prompt.
2. Display the generated composition as standard sheet music.
3. Play the composition using browser audio.
4. Highlight notes and measures during playback.
5. Allow users to manually edit notes.
6. Allow users to select notes or measures.
7. Regenerate only the selected portion using AI.
8. Preview multiple regenerated alternatives before accepting one.
9. Undo or redo any edit or regeneration.
10. Import MIDI files and convert them into editable notation.
11. Export compositions as MIDI.
12. Export compositions as MusicXML.
13. Save and reopen projects.
14. Support multiple tracks and instruments.
15. Provide a piano-roll view synchronized with the notation view.

The application must work locally without requiring an AI provider: include a deterministic mock generation provider so all functionality can be tested offline. Design AI integration through a provider abstraction so real LLM or music-generation services can be added later.

## 2. Technical Stack

React, TypeScript, Vite, Material UI, Zustand (app state), Immer (immutable updates), Zod (schema validation), VexFlow (notation rendering), Tone.js (audio playback), @tonejs/midi (MIDI import/export), Dexie/IndexedDB (persistence), Vitest (unit tests), React Testing Library (component tests), Playwright (e2e), ESLint, Prettier.

Use SVG rendering for VexFlow whenever possible. Do not use MusicXML, MIDI, VexFlow objects, or Tone.js objects as the central application state. Create a canonical internal score representation that acts as the source of truth.

## 3. Core Architecture

Layers:

```
UI: Score editor, Piano roll, Transport controls, AI generation controls, Track controls, Import/export dialogs
Application services: Command manager, Selection manager, Playback controller, Regeneration controller, MIDI converter, MusicXML converter, Persistence service
Domain: Score model, Rational time model, Validation, Quantization, Voice allocation, Musical utilities
Adapters: VexFlow renderer, Tone.js audio engine, MIDI parser/writer, MusicXML reader/writer, AI generation providers
```

Keep domain logic independent of React, VexFlow, Tone.js, MIDI, MusicXML, and browser APIs.

## 4. Internal Score Model

Strongly typed canonical score model. Do not use floating-point seconds as the primary musical timeline. Represent musical positions and durations using ticks or rational fractions. Configurable pulses-per-quarter-note; default 480 PPQ.

Base types (improve where appropriate):

```ts
type UUID = string;
type Fraction = { numerator: number; denominator: number };
type PitchStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";
type Accidental = -2 | -1 | 0 | 1 | 2;
type Pitch = { step: PitchStep; accidental: Accidental; octave: number };
type TimeSignature = { numerator: number; denominator: number };
type KeySignature = { fifths: number; mode: "major" | "minor" };
type TempoEvent = { id: UUID; tick: number; bpm: number };
type NoteEvent = {
  id: UUID; pitch: Pitch; startTick: number; durationTicks: number;
  velocity: number; voiceId: UUID; trackId: UUID;
  tieStart?: boolean; tieStop?: boolean;
  articulation?: "staccato" | "accent" | "tenuto" | "marcato";
};
type RestEvent = { id: UUID; startTick: number; durationTicks: number; voiceId: UUID; trackId: UUID };
type MusicalEvent = NoteEvent | RestEvent;
type Voice = { id: UUID; name: string; events: MusicalEvent[] };
type Measure = {
  id: UUID; index: number; startTick: number; durationTicks: number;
  timeSignature: TimeSignature; keySignature: KeySignature; voices: Voice[];
};
type Track = {
  id: UUID; name: string; instrumentName: string; midiProgram: number; midiChannel: number;
  clef: "treble" | "bass" | "alto" | "tenor" | "percussion";
  volume: number; pan: number; muted: boolean; solo: boolean; measures: Measure[];
};
type ScoreMetadata = { title: string; composer?: string; description?: string; createdAt: string; updatedAt: string };
type Score = { id: UUID; version: number; ppq: number; metadata: ScoreMetadata; tempoMap: TempoEvent[]; tracks: Track[] };
```

Utility functions required: fraction normalization; fraction addition/subtraction; tick conversion; measure length calculation; pitch-to-MIDI conversion; MIDI-to-pitch conversion; enharmonic spelling; note range validation; transposition; duration decomposition; splitting notes across measure boundaries; joining tied notes; determining beat boundaries; determining measure boundaries; locating a note at a score position; converting ticks to seconds; converting seconds to ticks.

All musical calculations must have unit tests.

## 5. Project Layout

```
src/
  app/            App.tsx, router.tsx, theme.ts
  components/     layout/, toolbar/, dialogs/, inspector/, transport/
  features/       score-editor/, piano-roll/, playback/, generation/, midi/, musicxml/, projects/, history/
  domain/         score/, time/, pitch/, commands/, selection/, validation/, quantization/
  services/       playback/, persistence/, generation/, import-export/
  adapters/       vexflow/, tone/, midi/, musicxml/
  store/          useAppStore.ts, slices/
  workers/
  test/
```

Avoid large monolithic files; prefer small, testable modules.

## 6. Main User Interface

Professional desktop-first interface; responsive but optimized for laptop/desktop. Default layout:

```
┌──────────────────────────────────────────────────────────────┐
│ App bar: project title, save, undo, redo, import, export     │
├───────────────┬──────────────────────────────────┬───────────┤
│ Track panel   │ Main editor (sheet notation OR   │ Inspector │
│ (Piano,       │ piano roll)                      │ (note     │
│ Strings, Bass,│                                  │ props, AI │
│ Drums)        │                                  │ tools)    │
├───────────────┴──────────────────────────────────┴───────────┤
│ Transport: rewind, play, pause, stop, loop, tempo, position  │
└──────────────────────────────────────────────────────────────┘
```

Include: app bar, track list, score editor, piano-roll editor, inspector panel, generation panel, playback transport, status bar, toast notifications, confirmation dialogs, keyboard-shortcut help dialog. Provide light and dark themes. Use Material UI consistently.

## 7. Score Editor

Interactive sheet-music editor using VexFlow. Must:

1. Render multiple staves. 2. Render multiple tracks. 3. Render treble and bass clefs. 4. Render notes, rests, chords, beams, ties, measures, key signatures, and time signatures. 5. Use SVG output. 6. Associate rendered SVG elements with domain object IDs. 7. Allow note selection. 8. Allow measure selection. 9. Support shift-click multi-selection. 10. Support drag-box selection. 11. Highlight selected notes and measures. 12. Highlight the currently playing note. 13. Scroll the active playback measure into view. 14. Re-render efficiently when only a small region changes. 15. Preserve selection where possible after rendering.

Editing operations: insert note; insert rest; delete selected notes; move notes horizontally; move notes vertically; transpose by semitone; transpose by octave; change duration; change velocity; change accidental; change articulation; add/remove ties; copy; cut; paste; duplicate; select all; select a measure; select a track; quantize selected notes; move selected notes to another voice; change clef; change time signature; change key signature; add measure; delete measure; add track; delete track.

Keyboard shortcuts:

```
Space: play/pause. Escape: clear selection. Delete: delete selected notes.
Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z: redo. Ctrl/Cmd+C: copy. Ctrl/Cmd+X: cut. Ctrl/Cmd+V: paste.
ArrowUp/ArrowDown: move pitch up/down (semitone). Shift+Up/Shift+Down: move pitch up/down one octave.
ArrowLeft/ArrowRight: move selection backward/forward.
```

Prevent edits that create invalid measures unless the editor automatically resolves them. Show validation errors clearly.

## 8. Piano-Roll Editor

Synchronized piano-roll view including: vertical piano keyboard, time grid, measures, beats, subdivisions, notes as draggable rectangles, velocity visualization, current playback cursor, track filtering, zoom controls, snap controls, quantization controls, loop-region display, selection synchronization with the sheet editor.

Users can: drag notes horizontally/vertically; resize note durations; create notes by double-clicking; delete notes; select multiple notes; quantize notes; adjust velocity; move notes between tracks; loop selected regions.

Changes in either view must immediately update the other.

## 9. Selection Model

Centralized selection system supporting: notes, rests, measures, tick ranges, tracks, voices, regeneration regions.

```ts
type ScoreRange = { startTick: number; endTick: number; trackIds: string[] };
type ScoreSelection = { eventIds: string[]; measureIds: string[]; trackIds: string[]; range?: ScoreRange };
```

Shared by: sheet editor, piano roll, inspector, regeneration panel, playback loop controls, copy/paste, delete, quantization.

## 10. Playback Engine

Tone.js behind an abstraction:

```ts
interface PlaybackEngine {
  initialize(): Promise<void>;
  loadScore(score: Score): Promise<void>;
  play(fromTick?: number): Promise<void>;
  pause(): void;
  stop(): void;
  seek(tick: number): void;
  setTempoMultiplier(multiplier: number): void;
  setLoop(range: ScoreRange | null): void;
  setTrackMute(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  dispose(): void;
}
```

Requirements: start audio only after user interaction; schedule notes accurately; support tempo changes; pause/resume; seeking; looping; mute/solo; per-track volume and pan; highlight active notes; update playback cursor smoothly; avoid drift during long playback; reschedule safely after edits; stop stuck notes; handle browser tab suspension gracefully.

Instruments (synthesized, fallback synth if samples unavailable; structure so SoundFont/sample libraries can be added later): Piano, Electric piano, Strings, Bass, Synth lead, Drum kit.

## 11. AI Generation System

Provider-independent API:

```ts
interface MusicGenerationProvider {
  id: string;
  name: string;
  generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult>;
  regenerateRegion(request: RegenerateRegionRequest, signal?: AbortSignal): Promise<RegenerateRegionResult>;
}
```

Zod schemas for all requests and responses.

```ts
type GenerateScoreRequest = {
  prompt: string; title?: string; style?: string; mood?: string;
  durationMeasures: number; tempo?: number;
  timeSignature?: TimeSignature; keySignature?: KeySignature;
  tracks: Array<{
    name: string; instrumentName: string; midiProgram: number; clef: Track["clef"];
    range?: { lowestMidi: number; highestMidi: number };
    maximumPolyphony?: number;
  }>;
  complexity?: "simple" | "moderate" | "complex";
};

type RegenerateRegionRequest = {
  scoreId: string; instruction: string; range: ScoreRange;
  precedingContext: ScoreFragment; selectedFragment: ScoreFragment; followingContext: ScoreFragment;
  constraints: {
    preserveMeasureCount: true; preserveTimeSignatures: true; preserveTempoEvents: true;
    preserveBoundaryNotes?: boolean; preserveHarmony?: boolean; preserveRhythm?: boolean; preserveMelody?: boolean;
    maximumPolyphony?: number;
    allowedPitchRangeByTrack?: Record<string, { lowestMidi: number; highestMidi: number }>;
  };
  candidateCount: number;
};
```

Generation behavior — the system must: generate structured score JSON; never return rendered notation; never return MIDI as the primary response; never directly mutate application state; validate responses with Zod; validate musical structure; reject invalid measure lengths; reject notes outside track ranges; reject negative durations; reject overlapping monophonic notes when not allowed; normalize IDs; normalize tick positions; repair minor structural issues where safe; report unrepairable errors clearly.

Deterministic mock provider generating: simple melodies; chord progressions; bass lines; drum patterns; variations of selected regions; more energetic versions; simpler versions; more syncopated versions; higher/lower melodic versions; major-to-minor transformations; rhythmic variations. Repeatable output from a seed; seed input in developer settings.

## 12. Regeneration Workflow

1. User selects a region. 2. User enters a regeneration instruction. 3. App extracts preceding, selected, and following context. 4. App sends structured request to provider. 5. Provider returns 1–3 candidate fragments. 6. Validate every candidate. 7. Show candidates in a preview panel. 8. Allow playback of each candidate in context. 9. Do not alter the original score during preview. 10. Allow accepting one candidate. 11. Replace only the selected region. 12. Preserve unaffected tracks and notes. 13. Single undoable history command. 14. Allow rejection of all candidates. 15. Allow retry with revised instructions.

Preset instructions: Make this more dramatic; Simplify this passage; Add rhythmic variation; Make the melody more memorable; Create a stronger transition; Add harmonic tension; Resolve the phrase; Make this more upbeat; Make this darker; Create a variation while preserving the melody; Preserve rhythm but change harmony; Preserve harmony but change melody; Add accompaniment; Thin out the orchestration.

Boundary conditions: notes tied into/out of the region; sustained notes crossing the region; pick-up measures; tempo changes; time-signature changes; key-signature changes; partial-measure selections; multi-track selections. For MVP, partial-measure regeneration may be converted internally into full-measure regeneration, but the UI must explain this behavior.

## 13. Preview System

Non-destructive preview layer: overlay a candidate fragment without modifying the original score; render candidate notes differently; original-versus-candidate comparison; candidate playback in musical context; switching among candidates; accept/reject; editing a candidate before accepting; preserve original selection. Preview state represented separately from committed score state.

## 14. Undo and Redo

Command-based history:

```ts
interface ScoreCommand {
  id: string; label: string; timestamp: number;
  execute(score: Score): Score;
  undo(score: Score): Score;
}
```

Commands: add note; delete notes; move notes; resize notes; change pitch; change duration; change velocity; add measure; delete measure; add track; delete track; change metadata; quantize notes; paste notes; replace regenerated region; import MIDI; change tempo; change key signature; change time signature.

AI regeneration recorded as one command. History size limited to a configurable number. Persist history for the current editing session (need not survive browser restarts).

## 15. MIDI Import

Use @tonejs/midi. MIDI import wizard including: file selector; track list; track names; MIDI channel; instrument; note count; duration; tempo events; time signatures; import-track checkboxes; target clef; quantization value; minimum note duration; tuplet detection option; sustain-pedal handling; piano staff-split option; split-point selection; key-detection option; preview.

Quantization values: whole, half, quarter, eighth, sixteenth, thirty-second, eighth triplet, sixteenth triplet.

Implement: note-on/note-off parsing; tempo map import; time-signature import; track-name import; instrument-program import; velocity import; sustain-pedal interpretation; quantization; removal of extremely short accidental notes; optional merging of near-duplicate notes; voice allocation; measure generation; staff assignment; clef selection; enharmonic spelling; key estimation.

Do not claim MIDI import perfectly reconstructs notation. Show a warning that MIDI contains performance timing rather than complete notation semantics. Users preview and adjust settings before committing. Import must be one undoable operation.

## 16. MIDI Export

Export canonical score as standard MIDI including: PPQ; tempo map; time signatures; track names; program changes; MIDI channels; note pitches; durations; velocity; volume; pan; sustain where represented; drums on channel 10 when appropriate. Download action; safe filename from project title. Test exported MIDI by re-parsing and comparing reconstructed events.

## 17. MusicXML Import and Export

Basic support: score metadata; part list; tracks; measures; notes; rests; chords; voices; clefs; key signatures; time signatures; ties; tempo; articulations supported by internal model. Provide import, export, .musicxml download, round-trip tests. Unsupported elements ignored safely and reported in an import summary. Do not block import on unsupported decorative engraving details.

## 18. Project Persistence

Dexie/IndexedDB. Store: project metadata; current score; last opened date; thumbnail/preview metadata; UI preferences; generation history metadata; autosave state.

Features: create/rename/duplicate/delete/open project; autosave; manual save; recent projects; export project as JSON; import project JSON. Versioned project schema with migrations. Validate loaded projects with Zod. Do not silently discard invalid project data.

## 19. Project Dashboard

New project; recent projects; import MIDI; import MusicXML; import project JSON; sample projects; delete/duplicate actions; search; sort by name or last modified.

At least three sample projects: 1) simple piano melody; 2) four-track pop arrangement; 3) short orchestral-style passage.

## 20. Inspector Panel

Editable properties. Notes: pitch, octave, accidental, duration, velocity, articulation, voice, track, start position, tie state. Measures: time signature, key signature, measure number, duration, regeneration controls. Tracks: name, instrument, MIDI program, MIDI channel, clef, volume, pan, mute, solo. Multi-selection property editing; show "mixed" for differing values.

## 21. Generation Panel

Right-side panel: prompt input, style, mood, complexity, instrumentation, number of measures, key, tempo, time signature, candidate count, seed, Generate button.

When a region is selected, switch to regeneration mode showing: selected measure range; selected tracks; regeneration instruction; preservation options; candidate count; generate alternatives; cancel; preview cards. Disable generation when the selection is invalid.

## 22. Playback Transport

Go to start; previous measure; play; pause; stop; next measure; loop toggle; metronome toggle; current measure and beat; tempo control; playback speed; master volume; timeline scrubber. Speeds: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×. Tempo changes remain proportionally correct when speed changes.

## 23. Validation

Score-validation engine validating: unique IDs; valid pitch ranges; positive durations; nonnegative tick positions; valid velocity; valid MIDI program values; valid MIDI channel values; valid time signatures; valid key signatures; correct measure duration; events contained within measures; correct tie targets; track references; voice references; overlapping events; monophonic voice rules; tempo map ordering; measure ordering; unsupported tuplets.

```ts
type ValidationIssue = {
  severity: "error" | "warning"; code: string; message: string;
  objectId?: string; trackId?: string; measureId?: string;
};
```

Display issues in the UI; clicking an issue navigates to the affected object.

## 24. Quantization

Reusable quantization engine: start-time quantization; duration quantization; swing; triplets; minimum duration; humanization tolerance; chord onset grouping; legato cleanup; overlap resolution; gap filling. Exposed in MIDI import and manual editing. Comprehensive unit tests for edge cases.

## 25. Voice Allocation

Basic voice allocation: group simultaneous notes as chords; separate overlapping independent lines; prefer minimal voice changes; avoid unnecessary rests; respect configurable maximum voices; assign piano notes to treble or bass staff; allow manual reassignment afterward. Output need not match professional engraving, but must be readable.

## 26. Rendering Strategy

```ts
interface ScoreRenderer {
  render(score: Score, container: HTMLElement, options: RenderOptions): RenderResult;
  update(score: Score, changes: ScoreChangeSet, container: HTMLElement, previous: RenderResult): RenderResult;
  dispose(): void;
}
```

RenderResult includes mappings from score IDs to SVG elements and bounding boxes; used for selection, playback highlighting, context menus, dragging, inspector navigation, accessibility. Render only visible systems where practical. Zoom controls. Page and continuous layout modes.

## 27. Accessibility

Keyboard navigation; ARIA labels; focus management; screen-reader descriptions for controls; high-contrast selection indicators; reduced-motion support; accessible dialogs; accessible tooltips; visible keyboard focus. Do not rely on color alone for selection or errors.

## 28. Error Handling

Centralized error handling for: invalid MIDI; invalid MusicXML; corrupted project files; audio initialization failure; generation-provider failure; invalid generation response; storage quota errors; rendering errors; unsupported browser features. Clear error messages without raw stack traces for ordinary users; log technical details in development mode; retry actions where appropriate.

## 29. Performance

Memoized selectors; efficient immutable updates; Web Workers for MIDI parsing and expensive quantization; debounced autosave; incremental score rendering where possible; virtualization for large track lists or long scores; cached tick-to-time calculations; cached pitch spelling; cached render measurements.

Responsive with: ≥20 tracks; ≥500 measures; ≥20,000 note events. Provide a benchmark/performance-test utility using generated scores.

## 30. Testing

Unit tests: fraction utilities; tick conversion; pitch conversion; transposition; measure length; duration decomposition; note splitting; tie generation; tempo conversion; quantization; voice allocation; score validation; MIDI import; MIDI export; MusicXML import; MusicXML export; command execution; command undo; region replacement; generation response validation; persistence migrations.

Component tests: toolbar; transport; track list; inspector; generation panel; import dialogs; selection behavior; regeneration preview; error dialogs.

Playwright e2e: 1) create new project; 2) generate a composition; 3) play the score; 4) select notes; 5) change pitch; 6) undo/redo; 7) select measures; 8) generate alternatives; 9) preview an alternative; 10) accept the alternative; 11) export MIDI; 12) import MIDI; 13) save and reopen project; 14) export MusicXML; 15) switch between notation and piano-roll views. Deterministic fixtures.

## 31. Seeded Mock Generator

Musically useful seeded mock generator supporting common scales, keys, chord progressions, meters. Include: major scales; natural minor; harmonic minor; pentatonic; common chord progressions; arpeggios; Alberti bass; block chords; walking bass; basic drum grooves; syncopation; melodic contour generation; phrase repetition; cadences; rhythmic variation.

Example progressions: I–V–vi–IV; ii–V–I; i–VI–III–VII; I–vi–IV–V; twelve-bar blues.

Generation must always satisfy measure lengths and be deterministic for the same request and seed.

## 32. Sample Generation Instructions

Preset prompts: Create a gentle eight-measure piano melody in C major; Create a cinematic sixteen-measure theme in D minor; Create an upbeat pop arrangement with piano, bass, drums, and strings; Create a simple beginner melody using quarter and half notes; Create a jazz-inspired progression with a walking bass; Create an energetic video-game battle theme; Create a calm ambient piano piece; Create a playful waltz in 3/4 time.

## 33. Developer Settings

Developer settings dialog: mock-provider seed; enable generation diagnostics; show score IDs; show tick positions; show measure boundaries; show playback scheduling data; enable validation warnings; reset local database; generate stress-test score; export diagnostic JSON. Hidden behind a developer-mode toggle.

## 34. Documentation

README.md; architecture overview; setup instructions; development commands; testing commands; build instructions; explanation of internal score model, rendering, playback, MIDI import, regeneration, adding a real AI provider; known limitations; keyboard shortcuts; troubleshooting. Mermaid architecture diagram. Example provider code.

## 35. Environment and Commands

Must support: `npm install`, `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`. Build without TypeScript errors. No critical lint errors. No empty placeholders for core features. No pseudocode where executable implementation is expected.

## 36. Implementation Priorities

Phase 1: Domain foundation (score model, fraction/tick utilities, pitch utilities, validation, commands, selection, test fixtures). Phase 2: Basic editor (project dashboard, track list, VexFlow rendering, note selection, basic note editing, undo/redo). Phase 3: Playback (Tone.js engine, transport, playback cursor, note highlighting, looping, mute/solo). Phase 4: Generation (provider interface, seeded mock provider, full-score generation, region extraction, candidate regeneration, preview and acceptance). Phase 5: MIDI (import wizard, quantization, export, round-trip tests). Phase 6: Piano roll (rendering, dragging, resizing, synchronized selection, velocity editing). Phase 7: MusicXML and persistence (import/export, IndexedDB, autosave, project import/export). Phase 8: Polish (accessibility, performance, error handling, e2e tests, documentation).

## 37. Important Design Constraints

1. The canonical score model is the source of truth.
2. Do not store VexFlow objects in global state.
3. Do not store Tone.js objects in global state.
4. Do not use MIDI as the live editing model.
5. Do not use MusicXML as the live editing model.
6. Do not use floating-point seconds for score editing.
7. Every score mutation must go through a command.
8. Every AI-generated response must be validated.
9. Regeneration previews must be non-destructive.
10. AI regeneration must be undoable as one action.
11. Imported MIDI must be previewed before committing.
12. Rendering and playback must consume the same canonical score.
13. Selection must be centralized.
14. Domain code must remain independent of UI libraries.
15. Core features must work offline through the mock provider.

## 38. MVP Scope Boundaries

Support well: notes; rests; chords; basic multiple voices; treble and bass clefs; key signatures; time signatures; ties; basic articulations; multiple tracks; MIDI import/export; basic MusicXML; AI passage regeneration; piano-roll editing.

Future work (mark as such, do not implement): lyrics; guitar tablature; percussion notation engraving; complex tuplets; cross-staff beaming; grace notes; advanced ornaments; ossia staves; microtonal notation; professional page-layout controls; real-time collaboration; audio recording; VST plug-ins; full MuseScore compatibility.

## 39. Acceptance Criteria

1. User opens the application. 2. Creates a new project. 3. Enters "Create a gentle eight-measure piano piece in A minor." 4. Mock provider generates a valid score. 5. Score appears as readable sheet notation. 6. User presses Play. 7. Score plays and notes highlight in sync. 8. User selects measures 3 and 4. 9. Enters "Make this section more dramatic while preserving the melody." 10. App generates three alternatives. 11. User previews each. 12. Accepts one. 13. Only measures 3 and 4 are replaced. 14. User changes one note manually. 15. Undoes and redoes the change. 16. Opens the piano roll. 17. Same notes appear there. 18. Drags one note. 19. Notation view updates. 20. Exports a MIDI file. 21. Imports the exported MIDI into a new project. 22. Resulting notes and timing are substantially equivalent. 23. Exports MusicXML. 24. Saves and reopens the project. 25. All operations complete without uncaught errors.

## 40. Final Deliverables

Complete source code; working package configuration; Vite configuration; TypeScript configuration; ESLint and Prettier configuration; all required React components; domain model; VexFlow renderer; Tone.js playback implementation; MIDI import/export; basic MusicXML import/export; mock AI generation provider; regeneration preview workflow; command-based undo/redo; IndexedDB persistence; unit tests; component tests; e2e tests; sample projects; full README and architecture documentation.

Prioritize correctness, maintainability, testability, and a strong editing experience over excessive feature count.
