# music_app_rn — spike findings and plan

The React Native app: iOS, iPad, Android phone and tablet, and macOS.

**Windows is out of scope.** The research done for it is parked in
[rn-windows-findings.md](rn-windows-findings.md) rather than deleted; nothing
in this plan depends on it. Dropping Windows removed an entire Phase 0 refactor
— the WebView renderer host — because macOS draws with Skia like every other
platform here.

This records what the spike established, and the order the work has to happen
in: the library refactors first, because the app cannot be built on top of
libraries that assume a browser and a signed-in user.

## What the spike established

Everything below is evidence, not inference. Where a claim rests on a _missing_
match rather than a found one it says so, because that is how this spike got
two of its answers wrong the first time — see "Corrections" at the end.

### Rendering — Skia everywhere

| platform  | renderer | evidence                                                                                                    |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| iOS, iPad | Skia     | `@shopify/react-native-skia` ships `apple/`                                                                 |
| Android   | Skia     | ships `android/`                                                                                            |
| macOS     | Skia     | `sudojo_app_rn/macos/Podfile.lock` links `react-native-skia (2.2.12)` in a working react-native-macos build |

One renderer on every platform, and `music_drawing` already supports it.
`DrawingContext2D` is the seam — the canvas 2D API narrowed to the calls the
renderer actually makes — and `skia/skia-context.ts` already implements it over
a Skia canvas, with the Skia module injected by the host rather than depended
on. So `CanvasScoreRenderer` and VexFlow run unchanged, and there is no drawing
work in Phase 0 at all.

### Audio — native on every platform

The earlier conclusion that macOS had no native audio path was wrong. It
generalised from one library's iOS-only podspec instead of from what the engine
actually needs.

`music_player` already ships a native RN engine, `RNSamplePlaybackEngine`,
which plays pre-rendered FluidR3 sample packs rather than synthesising. What it
asks of a platform is declared structurally in `rn/playback/audio-api.ts` —
`AudioContext`, `decodeAudioData`, gain / buffer-source / stereo-panner /
biquad — and injected, not imported:

```ts
loadAudioApi?: () => Promise<AudioApi>;   // ctor dep, defaults to the RN module
```

So the desktop question was never "port libfluidsynth to React Native". The
synthesis is already solved offline, and the seam takes any backend.

| platform           | engine                                                 | evidence                                                               |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| web                | js-synthesizer (libfluidsynth in an AudioWorklet)      | shipping                                                               |
| iOS, iPad, Android | `RNSamplePlaybackEngine` over `react-native-audio-api` | shipping                                                               |
| macOS              | **libfluidsynth + `AVAudioSourceNode`**                | proven end-to-end in the spike against our actual `FluidR3Mono_GM.sf3` |

macOS is the strong result: not inferred, but run against the real soundfont.
TinySoundFont + miniaudio is the MIT alternative if libfluidsynth's LGPL
position under a sandboxed Mac App Store build proves awkward — at the cost of
reverb and chorus, which TSF does not implement.

**One sharp edge to design around.** A native module's event callback is
initialised to a no-op and only goes live once JS first reads the property;
events emitted before that are silently dropped, not buffered, and there is no
coalescing. So emit one batched payload from a fixed 30 Hz timer rather than
one per audio callback, and dead-reckon the caret in JS — which `PlaybackCaret`
already does on web, for exactly this reason.

### Payments

| platform                  | route                           |
| ------------------------- | ------------------------------- |
| iOS, iPad, Android, macOS | RevenueCat IAP                  |
| web                       | Stripe via RevenueCat's web SDK |

`react-native-purchases` 9.10.3 declares
`spec.platforms = {:ios => "13.0", :tvos => "13.0", :osx => "14.0"}` and
`sudojo_app_rn/macos/Podfile.lock` links `RevenueCat (5.59.2)`, so macOS IAP is
proven rather than assumed.

**macOS IAP means StoreKit, which means Mac App Store, which means sandboxing.**
The file layer must therefore use the document picker and security-scoped
bookmarks on macOS — it cannot open a path it was merely given.

## Decisions

- Full editor parity: edit, play, generate, import and export.
- Documents are Project JSON, `.moosiac`, opened and saved by `music_io`.
- macOS shows **tabs in one window**, one `createEditingStore()` per tab.
- Local files and server projects are **separate places**. A local file can be
  promoted once, explicitly, by **Sync to server**; from then on it behaves
  exactly like a web project. There is no background sync and no merge.
- Mobile requires sign-in and works only on server projects.
- Phones are landscape-locked; tablets and macOS are free.
- English and Chinese, matching the web app.

## Phase 0 — library refactors, before any app code

These are the things that make the app possible rather than merely easier.

### 0.1 `music_lib`: a store without a server

`StoreContext` requires `client: MusicClient` and `getToken`, so a signed-out
macOS user cannot have a store at all. Requirement 6 depends on this.

The editing store already needs none of it — that is what the music_editing
split established — so the work is to make the _application_ store's
server-facing slices optional, and to have the features that need a server
(generation, snapshots, publishing) report themselves unavailable rather than
fail. A local document is not a degraded project; it is a different thing.

### 0.2 `music_player`: a native macOS engine

libfluidsynth + `AVAudioSourceNode` behind a native module, implementing
`PlaybackEngine`. It belongs in music_player beside the other engines, for the
reason that interface exists at all.

Written as a C++ core with a thin platform shim rather than as Objective-C
throughout, because the same core would serve iOS and Android later if the
sample-pack engine is ever retired — see the open question below. That costs
nothing now and forecloses nothing.

Position reporting is the part to get right, and the constraint is the event
rule above: a fixed 30 Hz batched emit, with the caret dead-reckoning in JS.
Bridge latency must be **measured and compensated** the way the web app already
compensates for output latency, not assumed to be zero.

### 0.3 `music_io`: desktop files

The RN entry uses `react-native-fs` and `react-native-share`, which are
mobile-shaped. macOS needs open and save dialogs, a recent-files list, and —
because the Mac App Store build is sandboxed — security-scoped bookmarks so a
recent file can be reopened without asking again.

## Phases after that

1. **Scaffold** — repo, three platform builds (iOS universal, Android, macOS),
   Firebase per platform (native on mobile, web SDK on macOS), i18n,
   orientation lock, navigation.
2. **Read-only score** — open a document and render it on every platform.
   Proves 0.3 and the Skia renderer together.
3. **Playback** — transport, caret, following scroll. Proves 0.2.
4. **Editing** — note entry, the inspector, the toolbar, the piano keyboard.
5. **Documents** — tabs, local files, Sync to server.
6. **Server features** — projects, generation, credits, snapshots, publishing.

## Corrections this spike made to itself

Recorded because each was a method error, not a fact error, and the same method
would produce the same result again. (Two further corrections, both about
Windows, are in the parked findings.)

1. **"RevenueCat has no macOS support"** — concluded from a grep that returned
   nothing. `react-native-purchases`' podspec declares `:osx` and
   `sudojo_app_rn` links it. Absence of a match is not evidence of absence.
2. **"Neither desktop has a native audio path"** — generalised from
   `react-native-audio-api`'s iOS-only podspec to the whole platform, without
   asking what our own engine actually requires. It requires a sample mixer,
   and macOS has several.

## Open questions

- Whether the macOS build also ships direct (unsandboxed) alongside the Mac App
  Store build. Deferred; the file layer should not assume it is unsandboxed.
- Whether libfluidsynth's LGPL position is acceptable inside a sandboxed,
  re-signed Mac App Store package. If not, TinySoundFont is the MIT fallback
  and the decision is reverb and chorus. A lawyer question, not a research one.
- Whether the native platforms should eventually converge on one C++ synth
  core, retiring `RNSamplePlaybackEngine`. Not now — it works, and churning a
  shipping engine to remove a second implementation is a trade to make
  deliberately, if ever.
