# Async generation jobs, and replacing music by scope

**Status:** draft 2026-08-07
**Goal:** make every AI generation a persisted server-side job, and reach generation from the thing you want to change — selected notes, selected measures, or a track — rather than from a panel that generates whole scores.

Two changes that only make sense together. Generation takes minutes, so it cannot hold a browser request; and once it is a background job, the panel that assumed a synchronous result has to go anyway.

## Why a job at all

Generation is slow enough that the current model — the browser holds an HTTP request open for up to fifteen minutes — fails in ordinary use. Close the tab, sleep the laptop, or lose the network and the work is gone with no record it ever happened. Worse, there is nothing else to do meanwhile: the one score you are waiting on is the one you have open.

A job fixes both. The server owns the work, the browser owns nothing, and waiting becomes navigation rather than patience.

## The four things that generate

| Action               | Scope of replacement                  | Where it lives                  |
| -------------------- | ------------------------------------- | ------------------------------- |
| **Generate Track**   | a new track, spanning the whole score | toolbar `+` menu (exists today) |
| **Replace Notes**    | the selected notes' exact tick span   | Note tab                        |
| **Replace Measures** | the selected measures                 | Measure tab                     |
| **Replace Track**    | the active track, whole score length  | Track tab                       |

Plus **Generate Score** on the dashboard, which creates a new project rather than editing one. It is a job like the others: it creates the project immediately — named from the prompt, holding an empty score, status `generating` — and the job fills it in. Whole-score generation is the slowest of the five, so it is the one that most needs to be walked away from, and creating the project up front means it appears in the projects list with its badge from the first second rather than materialising minutes later out of nowhere.

## One candidate, always

Generation returns exactly one result and it is applied. There is no candidate list, no A/B compare against the original, and no accept step. Undo is the escape hatch.

This follows from the job model rather than being an independent taste decision: when a job finishes, the person who started it is very likely not looking at that project, and a result that requires a decision before it means anything would leave the project in limbo indefinitely. Requests pin `candidateCount: 1`.

What this deletes from the app: `CandidateList.tsx`, `preview.ts`, `RegenerationPanel.tsx` and their tests, and `previewFragment` — which is currently threaded through roughly ten places in `ScoreEditorView` for the sole purpose of suppressing editing while a preview overlay is up. Every one of those guards goes.

`music_types`' `RegenerateRegionResult.candidates` array stays as the wire format, carrying one entry. Collapsing the type is a follow-up, not part of this work: it touches a published package for no behavioural gain.

## The job object

A `generation_jobs` table:

| Column                       | Notes                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                         | uuid                                                                                                |
| `user_id`                    | owner; every read is scoped to it                                                                   |
| `project_id`                 | always set — see Generate Score, which creates its project first                                    |
| `kind`                       | `generate-score` \| `generate-track` \| `replace-notes` \| `replace-measures` \| `replace-track`    |
| `request`                    | the full provider request, jsonb — everything needed to run it without consulting the project again |
| `status`                     | `running` \| `done` \| `failed` \| `cancelled`                                                      |
| `result`                     | the produced `Score` or `ScoreFragment`, jsonb, null until done                                     |
| `error`                      | message, null unless failed                                                                         |
| `created_at` / `finished_at` |                                                                                                     |

The request is stored whole and the job never re-reads the project. That is what makes the result well-defined: it was generated against a known input, and (see below) that input cannot have changed.

`projects` gains `status: 'ready' | 'generating'`, defaulting to `ready`.

Two states, not three. A job's own lifecycle is richer than the project's, but the project only needs to answer one question: can I be edited right now?

## Lifecycle

```
POST /jobs ──► job: running, project: generating ──► provider ──► result
                                                                    │
                        project still 'generating'? ────── yes ─────┼──► apply, project: ready, job: done
                                                                    │
                                                └────── no ─────────┴──► discard, job: cancelled
```

The status check on completion is the whole cancellation mechanism. Cancel does not need to reach into a running provider call; it writes `ready` to the project, and the finishing job sees that and throws its result away.

**Multi-step jobs check between steps.** Regeneration already splits a large selection along its measure grid into sequential chunks, each prompted with the previous chunk's regenerated tail as context (`chunked-regenerate.ts`). Dropping to one candidate does not remove this: candidates were the _parallel_ axis, chunks are the _sequential_ one, so a long selection is still many steps. Each step re-reads the project status and continues **only while it is still `generating`** — a cancel during a long chunked run stops it at the next boundary instead of paying for the remaining chunks.

A tick-exact Replace Notes region spans at most one measure and is therefore always a single chunk; the check costs nothing there and matters for Replace Track on a long score.

> This resolves a contradiction in the original brief, which said to apply the result when the status is `generating` (point 7) but to continue to the next step only when it is `ready` (point 8). Those are opposite tests, and a running job's project is always `generating`, so the literal point 8 would abort every job after its first step. `generating` means "still wanted" throughout.

## Applying the result needs `music_lib` on the server

Today `music_api` depends on `music_types` alone. It returns fragments; the browser applies them, through `applyCandidate` → `replaceRegionCommand`. Moving application to the server means the server needs that same logic, so **`music_api` takes a dependency on `@sudobility/music_lib`.**

This is what `music_lib` being platform-free is for, and it is the only honest option. The alternative — store the fragment and let the client splice it in whenever it next opens the project — leaves the score and its pending result as two sources of truth, so an export, a snapshot, or a published link taken in between would serve music that does not include the generation the project claims to have finished.

The command must be applied to the score **as stored**, not as the job remembered it. Since the project is immutable while generating, those are the same score — which is the second reason immutability is a guarantee rather than a nicety.

## Immutability is enforced, not just greyed

The API rejects `PUT /projects/:id` while the project is `generating`.

This is not defensive habit. Auto-apply is only correct if the score cannot have moved under the job — otherwise a result generated against measures 1–8 lands on a score where those measures no longer mean the same thing. The greyed-out editor is the courtesy; the server rejection is the guarantee, and it covers the cases the UI cannot: a second tab, a stale client, an autosave already in flight when the job started.

Autosave must therefore stop while generating rather than pile up failing requests.

## Crash recovery

On boot, any job still marked `running` is set `failed` and its project released to `ready`. An in-flight provider call cannot be resumed after a restart, and the alternative is a project stranded in `generating` with nothing left alive to finish it.

## Finding out it is done

The client polls. A project list already runs through React Query, so the projects view refetches on an interval whenever any project it can see is `generating`, and stops when none are. An open project polls its own status on the same rule.

No websockets or SSE. Polling a handful of rows every few seconds is proportionate to work measured in minutes, and it survives reconnects for free.

## Deciding what to replace

Pure functions in `music_lib`, one per scope, all returning the same shape: a tick range, the track ids it covers, and whether that range is measure-aligned.

| Scope    | Range                                     | Tracks                             | Measure-aligned |
| -------- | ----------------------------------------- | ---------------------------------- | --------------- |
| Notes    | min start → max end of the selected notes | tracks owning those notes          | **no**          |
| Measures | span of the selected measures             | tracks of the selected measure ids | yes             |
| Track    | 0 → score length                          | the active track                   | yes             |

**Notes is the one that does not fit the existing pipeline.** `prepareRegenerationRequest` always snaps a selection out to full-measure boundaries; "replace only these notes" forbids exactly that. The fix is a range-taking entry point that the existing selection-based function delegates to, so the snapping policy stays in one place rather than becoming a boolean each caller can get wrong.

Measure selection needs no new rule: a gutter click already selects that measure on the active track and cmd-shift-click across all tracks, so the selected ids carry the track set.

**A non-contiguous selection is replaced as its bounding span.** Select the notes on beats 1 and 4 and the notes on 2 and 3 go too. The modal states the exact range and how many notes fall inside it, including how many were not selected, so this is never discovered after the fact.

`preserveMeasureCount` is currently hardcoded true in `RegenerationConstraints`. It becomes conditional on the region actually being measure-aligned — for a sub-measure span it is meaningless and only muddies the prompt, which instead states the exact span to fill.

## The modal

One `ReplaceMusicDialog`, a `FormModal`, parameterised by scope. The three buttons differ only in scope and label.

Fields: instruction with the existing preset menu, style, mood, complexity, and the four preservation checkboxes. Not present: instrumentation, measure count, tempo, key and time signature — all fixed by the region being replaced — and candidate count, which is now always one.

Above the fields, a plain statement of what will be replaced: `Measures 3–4, track "Piano" — 12 notes.`

Submitting closes the modal and creates a job. The editor greys immediately.

`style`, `mood` and `complexity` are new optional fields on `RegenerateRegionRequest`. `buildRegeneratePrompt` emits them as the three lines `buildGeneratePrompt` already emits for whole-score generation.

## Generating while you wait

An editor on a `generating` project is covered by an overlay: "Generating notes…" and a Cancel button. Cancel sets the project `ready`; the editor unlocks immediately without waiting for the job to notice.

Navigating away is ordinary navigation. The projects view marks each generating project and offers Cancel there too, so a job can be abandoned without opening the thing it is working on.

## Generate Score moves to the dashboard

`GenerationPanel`'s field set — prompt, style, mood, complexity, instrumentation, measures, tempo, key, time signature — becomes a dashboard modal beside New Project and the templates.

Submitting creates the project straight away, empty and `generating`, and starts a job against it. You land in the projects list watching it generate, or open it and watch the same overlay every other generation shows. Cancelling a Generate Score leaves the empty project behind rather than deleting it — the same rule as every other cancel, which returns the project to whatever it was before the job.

Whole-score generation belongs where a score is born. Today it is the only way to get an AI-generated multi-track arrangement, and removing the sidebar panel without moving it would delete that capability outright.

## Testing

- Region derivation is pure and gets the bulk of the unit tests: tick-exact notes, a non-contiguous selection's bounding span, measure spans across one and many tracks, a whole track, and an empty selection.
- A job that completes against a `generating` project applies its result; one that completes against a `ready` project discards it. Both directions, because the discard path is the cancellation feature.
- A chunked job cancelled mid-run stops at the next step boundary and does not request the remaining chunks — asserted by counting provider calls, not by timing.
- `PUT /projects/:id` on a `generating` project is rejected.
- Boot with a `running` job in the table fails it and releases the project.
- The projects list polls while something is generating and stops when nothing is.
- **e2e** — start a generation, confirm the editor locks, navigate to the projects view, confirm the badge, open a different project and edit it, return, confirm the result landed.
- **e2e** — start a generation, cancel it, confirm the editor unlocks and the score is untouched.

## Out of scope

- **Multiple candidates.** Removed, as above.
- **Resuming a job across a server restart.** Failed and released instead.
- **A real queue or multiple workers.** Jobs run in-process in the single `music_api` instance. A queue matters when concurrency does; it does not yet.
- **Progress percentages.** A job is running or it is not. The provider gives no meaningful progress signal, and a fake one is worse than none.
- **Notifying a user whose tab is closed.** No email, no push. The result is there when they come back.
- **Collapsing `RegenerationCandidate` out of `music_types`.** Follow-up.

## Phasing

One spec, but the plan should land it in this order so each stage is verifiable:

1. **Job pipeline** — table, runner, status, cancel, immutability, crash recovery, polling, and the new `music_api` → `music_lib` dependency. Existing Generate Track becomes async. Shippable alone.
2. **Region derivation** — the pure functions, fully tested with no UI.
3. **The modal and the three buttons**, on top of 1 and 2. Old panels and candidate machinery deleted here.
4. **Dashboard Generate Score** and the `style`/`mood`/`complexity` plumbing.
