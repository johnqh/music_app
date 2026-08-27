# Windows on React Native — parked research

**Windows is out of scope.** This file exists so the verified findings survive
if it ever comes back; nothing here is part of the plan. See
[rn-app-plan.md](rn-app-plan.md).

Findings still unverified are marked **[?]**.

## Rendering: there is no off-the-shelf canvas

Positively established, not inferred from a failed search. Skia ships no
`windows/` directory, no `.sln`/`.vcxproj` in its `files` whitelist and no
`react-native.config.js`, and `react-native-skia-windows` 404s on npm. React
Native Directory filtered to Windows returns 72 libraries in total, of which
`canvas`, `graphics`, `chart` and `skia` each return **zero**. Reanimated's
maintainers state Windows "is not on our roadmap".

`react-native-svg` does ship working Windows code and is still unusable for a
score: its Fabric build registers `RNSVGText` and `RNSVGTSpan` as **unsupported
components**, and VexFlow draws noteheads, clefs and rests as font glyphs. That
gap comes from _their_ strategy — D2D's built-in
`CreateSvgDocument`/`DrawSvgDocument`, whose SVG engine supports no text, masks,
patterns or filters — not from a limit of Windows or RNW.

Precedent: Microsoft's Office team runs 40+ RNW experiences (Copilot pane,
Privacy Dialog, Accessibility Assistant) while the document canvas stays on
Direct3D/Composition. Microsoft uses RNW for chrome and keeps drawing off it.

**WebView2** was the cheap path: `react-native-webview` on RNW is Chromium, so a
browser `CanvasRenderingContext2D` satisfies `DrawingContext2D` as-is and
`CanvasScoreRenderer` runs unchanged — zero drawing code. Use
`source={{html}}`, **not** `source={{uri}}`, which renders blank on
react-native-webview 16 / RNW Fabric with no load or error events firing (open
issue #3990). 16.0.0 is on the `next` tag, not `latest`.

## Writing our own canvas: viable, costed at 8-12 weeks

RNW issue #12697 is open bookkeeping, not a live blocker. Its full title is
_"CompositionSwitcher.interop.h should be included in MS.RN.Cxx, and modified
to not use MSO_GUID types"_, and both halves shipped in **RNW 0.74** via PR
#12739, merged 18 days after the issue was filed. Verified by diffing published
tarballs: 0.73.22 had the header outside the public include path using
`MSO_STRUCT_GUID`; 0.74.59+ ships
`Microsoft.ReactNative.Cxx/CompositionSwitcher.Experimental.interop.h` with
standard `__declspec(uuid(...))`.

Two paths, and RNW's own IDL says which is sanctioned:

- **Path A** — `IInternalCreateVisual` + `Experimental::ICompositionContext`,
  what react-native-svg uses. Exists so Office can inject its own compositor;
  explicitly marked _"will be removed in a future version"_.
- **Path B** — `SetCreateVisualHandler`, returning a real
  `Microsoft.UI.Composition.Visual`, in the non-Experimental
  `Microsoft.ReactNative.Composition` namespace, no removal notice. First-party
  sample: `sample-custom-component/MovingLight.cpp` — swapping its
  `CreateColorBrush` for `CreateSurfaceBrush` is essentially the canvas.

The chain is public documented WinAppSDK API: `ViewComponentView.Compositor()`
-> `ICompositorInterop::CreateGraphicsDevice` -> `CreateDrawingSurface` ->
`ICompositionDrawingSurfaceInterop::BeginDraw` returning an
`ID2D1DeviceContext` -> draw -> `CreateSurfaceBrush` -> `SpriteVisual`. On Path
B we pass our own dirty rect, which RNW's `AutoDraw` wrapper hardcodes to
`nullptr`.

Text is the bulk of the work: Bravura via
`IDWriteFactory5::CreateInMemoryFontFileLoader` +
`CreateInMemoryFontFileReference` (pass `ownerObject = nullptr` so DirectWrite
copies the bytes) -> `CreateFontFace`, drawn with **`DrawGlyphRun`, not
`IDWriteTextLayout`** — SMuFL gives every glyph its own PUA codepoint so no
shaping is needed, and TextLayout's font fallback can silently substitute
another face. `measureText` from `DWRITE_GLYPH_METRICS` scaled by
`emSize / designUnitsPerEm`. **[?]** the descent formula is derived rather than
quoted and needs checking against a known glyph. Text on a composition surface
is proven inside RNW itself by `ParagraphComponentView`, the `<Text>` component.

Top risks: device-lost recovery is ours on Path B (react-native-svg never
solved it because Path A solved it for them); `ComponentViewFeatures::NativeBorder`
must be cleared, which also disables automatic positioning, so
`PointScaleFactor`/`Size`/`Offset` must be applied by hand from
`LayoutMetricsChanged`; and documentation past "create a visual" does not exist
— `DrawingSurface`, `Direct2D` and `SetCreateVisualHandler` get zero hits across
all 53 RNW prose doc sources.

## Audio

**TinySoundFont + WASAPI** (`IAudioClient3` shared mode) was the pick. TSF is
MIT, ARM64-trivial (source-only) and MSVC-clean — all 94 issues enumerated, none
about MSVC or build failures, and `tsf.h` has zero `_MSC_VER` conditionals. Two
costs: **no reverb or chorus** (`tsf.h` lines 570-571 mark both unsupported),
and mandatory gain staging — a measured peak of 2.012 on a 24-note chord.

WASAPI in **shared** mode via `IAudioClient3::GetSharedModeEnginePeriod` +
`InitializeSharedAudioStream` reaches the driver minimum; in-box HDAudio
supports 128 samples (2.66 ms at 48 kHz) to 480 samples (10 ms), and Win10+ cut
engine latency to 1.3 ms. **Exclusive mode is disqualifying** — it silences
every other application. Get the endpoint from `IMMDeviceEnumerator`, not
`MediaDevice::GetDefaultAudioRenderId`, which requires package identity.
XAudio2 2.9 is the lower-boilerplate second choice: in-box including ARM64, and
`XAUDIO2_VOICE_STATE.SamplesPlayed` gives a sample-accurate playhead free, at a
~10 ms quantum.

Ruled out on positive evidence: the **GS Wavetable synth** — the entire
`Windows.Devices.Midi.MidiSynthesizer` API surface is `CreateAsync`,
`AudioDevice`, `DeviceId`, `Volume`, `SendMessage`, `SendBuffer`,
`IsSynthesizer`, `Close`, with no sound-set, DLS or SoundFont loading member of
any kind; and **Windows MIDI Services**, which is MIDI 2.0 transport and
routing, every release still a pre-release, never claiming to be a synth.

**FluidSynth on Windows is the option to avoid**: vcpkg is at 2.5.7 behind
2.6.0, SF3 needs the `sndfile` feature enabled explicitly, and the LGPL
position under MSIX is unsettled — a Store package is sealed and re-signed, so
a user cannot relink. A lawyer question, not a research one. BASSMIDI (un4seen,
EUR 950, no royalties) is the escape hatch for SF3 + ARM64 + reverb with no
copyleft.

## Toolchain

RNW `v0.81-stable` is **0.81.35**; `latest` is 0.84.0. `PlatformToolset`
changed from `v143` (VS 2022) to `v145` (VS 2026) **inside the 0.81 line**,
between 0.81.25 and 0.81.30, while 0.82.8 is still `v143` — pin the patch
deliberately rather than floating on `^`. RNW 0.84 requires Visual Studio 2026.
The `1.0.0` on npm is a 2016 placeholder.

Paper is gone from RNW 0.82+ — Fabric only. Best structural reference for a
modern RNW C++ TurboModule: `ffmpeg-kit-extended@0.6.1`. Docs trap:
`/docs/native-modules*` all 404, live pages are `/docs/native-platform*`, and
there are no 0.81 docs on the site at all.

## Prior art, for whoever picks this up

- `react-native-track-player` 4.1.2 ships `android, ios, lib, src, web` — no
  `windows`. reactnative.directory's flag is wrong.
- `react-native-sound`'s Windows module `ProjectReference`s the pre-vnext
  "ReactWindows" C# framework, which modern RNW replaced. Dead.
- `react-native-video@6.19.2` ships `windows/` C++ but imports the **UWP**
  props variant; would need porting for a New-Arch Win32 app.

## Unverified [?]

- The `DWRITE_GLYPH_METRICS` descent formula, against a known Bravura glyph.
- Whether vcpkg `arm64-windows` actually builds fluidsynth — supported by the
  port's metadata, never built.
- Whether AudioGraph's `AudioBuffer` works in an unpackaged build.
