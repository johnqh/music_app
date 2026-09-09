# Voice tracks, picker order, and the vocal-led arrangement

Date: 2026-09-08
Repos: `music_types`, `music_lib`, `music_app`, `music_app_rn`

## The problem

Three things, all in the New Project → "Generate for me" flow.

1. **The Style picker is unsearchable.** Its 33 entries render in declaration
   order — Waltz, Jazz, Pop, Cinematic, Ambient, Battle, Rock … — which is the
   order the vocabulary was written in and no order a reader can navigate by.
   Mood has the same shape and the same problem.
2. **A voice track is unreachable.** The generation dialogs offer the General
   MIDI catalogue grouped by family, and the three programs that are a human
   voice (52 Choir Aahs, 53 Voice Oohs, 54 Synth Voice) are filed by GM under
   _Ensemble_, between String Ensemble and Orchestra Hit. Nobody looking to
   write a song finds them there, so in practice no generated score has a
   singer in it — even though `music_api` carries several hundred lines of
   rules about writing for one.
3. **In half the genres, the backing is written before the singer.**
   `rankTracksForGeneration` writes parts in role order so each can be composed
   against what already exists, and `roleOrderForStyle` puts `lead` **last** in
   the groove-led genres — reggae, funk, disco, soul, hip hop, trap, lofi,
   house, techno, trance, EDM. `vocalSupportRule` only fires for a part written
   _after_ the vocal, so in those styles nothing accompanies the voice; the
   voice is bent to fit a finished backing track. Pop uses `DEFAULT_ORDER` and
   already behaves correctly, which is why the failure is invisible until you
   try a genre that does not.

A fourth, found while reading: the **Presets popover is clipped**. It is an
`absolute` div inside `CollapsibleReveal`, whose inner wrapper carries
`overflow-hidden` because that is what makes the `0fr → 1fr` height collapse
work — so the menu is cut off at the bottom of the AI block. The Style and Mood
selects escape it only because Radix portals them.

## Principles this follows

- **Shared logic lives upstream, plumbing lives in the app.** Both apps show
  these pickers; anything either could get wrong on its own goes in
  `music_types`/`music_lib`. The two apps hold their instrument roster in
  different shapes (`{id, value}[]` on web so the same instrument can appear
  twice and survive reordering; `string[]` on native), so the _decisions_ are
  shared and the list splice is not.
- **One fact, one declaration.** The set of programs that are a voice is
  already declared in `arrangement-order.ts`. The picker group is derived from
  it rather than restating three numbers.
- **No program appears twice in one menu.** Lifting the voices to their own
  group means removing them from the family they came from.

## 1 · Style and mood sorted by their translated label

`music_types/src/domain/generation/option-order.ts` (new):

```ts
export function sortOptionsByLabel<T extends string>(
  values: readonly T[],
  labelOf: (value: T) => string,
  locale?: string,
): T[];
```

Pure, synchronous, dependency-free, no hooks — so it satisfies the four rules
for what may live in `music_types`, and reaches both apps through `music_lib`'s
re-export.

Sorting on the **translated** label rather than the key is the whole point: a
Chinese reader sorting on `electroSwing` gets English collation over strings
they cannot see. `localeCompare` with the active language handles both.

Call sites — every picker offering these two vocabularies:

| App    | File                                        | Pickers     |
| ------ | ------------------------------------------- | ----------- |
| web    | `features/projects/NewProjectDialog.tsx`    | style, mood |
| native | `features/generation/ScoreSetupFields.tsx`  | style, mood |
| native | `features/generation/ReplaceMusicSheet.tsx` | style, mood |

"No style" / "No mood" stay pinned above the sorted list in every one: they are
not members of the vocabulary, they are its absence.

## 2 · A Voice group, at the top

`arrangement-order.ts` exports its `VOICE_PROGRAMS` (today a private `Set`).

`instrument-options.ts` gains:

- `VOICE_OPTIONS: InstrumentOption[]` — the three programs under their GM
  names, ordered **Voice Oohs, Choir Aahs, Synth Voice**: the solo patch first,
  because it is the one a song is carried by and the one auto-added below.
- `DEFAULT_VOCAL_INSTRUMENT_VALUE = "53"`.
- `isVocalInstrumentValue(value: string): boolean` — false for any `kit:`
  value, since a percussion track is not a voice whatever its program says.
- `FAMILY_GROUPS` **excludes** the three from the Ensemble family.

`INSTRUMENT_OPTIONS` — the flat list behind the inspector's track picker and
the docs instrument table — keeps all 128 and is untouched. It is the
catalogue; `FAMILY_GROUPS` is a menu.

Rendering:

- web `InstrumentSelectItems.tsx`: a `Voice` group first, then Drum Kits, then
  the families.
- native `ScoreSetupFields.tsx`: its flat list gets the voices at the head,
  before the kits.

New i18n key `generate.voices` in both apps, `en` and `zh`.

## 3 · A vocal track added with the Generate toggle

Turning **Generate for me** on prepends `DEFAULT_VOCAL_INSTRUMENT_VALUE` when
the roster holds no voice. Turning it off removes **only the entry that was
added that way** — tracked per app, so a vocal the reader chose themselves
survives the toggle.

Choosing a Style overwrites the whole roster (deliberately — a preset that
skipped touched fields leaves an ensemble matching no genre), so `applyStyle`
re-prepends the vocal afterwards when the preset brought none of its own.

`music_lib` supplies the predicate `hasVocalInstrument(values)`; each app owns
its own splice, because the roster shapes differ.

Side effect worth naming: with the vocal first,
`firstMelodyInstrumentEntryId` marks it as the melody in the roster list, which
is the correct reading and needs no change.

## 4 · Lyrics

`GenerateScoreRequest.lyrics` has existed since the lyric rules were written
and no client has ever sent it. `GenerateScoreRequestDraft` gains
`lyrics?: boolean`, passed through `buildGenerateScoreRequest`.

Both apps show a **Write lyrics** switch in the AI block, rendered only when
`hasVocalInstrument` is true, defaulting on. Off — or with no voice in the
roster — the request omits the field and a vocal part comes back as a wordless
melody, which the model's own documentation is careful to call a different
piece of music from a song.

New keys `newProject.writeLyrics` and `newProject.writeLyricsHint`, both apps,
`en` and `zh`.

## 5 · The voice is written first, in every genre

In `rankTracksForGeneration`, `voiceFirst` is currently a tiebreak _among
equally ranked parts_. It becomes the primary sort key: a vocal track outranks
every role in every genre.

The justification is the one already written into the file for why order
matters at all — the first part is written with no constraints and every later
one bends to fit it — plus the fact that in a song the words and the tune _are_
the song. `GROOVE_FIRST` exists because in reggae the bassline is the material
and the melody decorates it; that reasoning holds for an instrumental and
inverts the moment there is a singer.

`roleOrderForStyle` is unchanged, so a score with no voice in it is arranged
exactly as it is today — which is what the tests should pin.

No `music_api` change: `vocalSupportRule` and the `"<NAME> IS THE SONG"` line
already say everything a backing part needs, and they begin firing for the
groove genres as a consequence of the reordering alone.

## 6 · The Presets popover

Fixed in `CollapsibleReveal`, not at the popover: the wrapper keeps
`overflow-hidden` while collapsed and through the 200ms transition, then
switches to `overflow-visible`. Any popover later added to that block is then
correct too. Web only — the native sheet has no prompt-preset menu.

## Testing

| What                                                                                                                                                        | Where                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `sortOptionsByLabel` — stability, locale, empty                                                                                                             | `music_types` unit                       |
| No program appears in two groups of one menu                                                                                                                | `music_types/instrument-options.test.ts` |
| `isVocalInstrumentValue` false for `kit:` values                                                                                                            | `music_types` unit                       |
| A vocal ranks first in a groove-led roster; a roster with no vocal is unchanged                                                                             | `music_types/arrangement-order.test.ts`  |
| `lyrics` reaches the request only when set                                                                                                                  | `music_lib/request.test.ts`              |
| Style/mood sorted; Voice group present; toggle adds and removes the vocal; a hand-picked vocal survives the toggle; lyrics switch appears only with a voice | `music_app/NewProjectDialog.test.tsx`    |
| Same, in the native sheet                                                                                                                                   | `music_app_rn` sheet tests               |
| New keys present in `en` and `zh`, with real CJK                                                                                                            | `locale-parity.test.ts`, both apps       |

## Out of scope

Committing, publishing or version-bumping anything: the work is left in the
working trees of the four repos.
