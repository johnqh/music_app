# Percussion sample packs

Rendered from **FluidR3Mono_GM.sf3** with `fluidsynth`, by
`music_io/scripts/build-percussion-packs.mjs`.

FluidR3 is distributed under Creative Commons Attribution 3.0.
Original soundfont by Frank Wen. Redistribution of these renderings is
permitted under that licence, with attribution.

One file per General MIDI drum kit, named by the program that selects it
(`percussion_0` is the Standard Kit, `percussion_25` the TR-808, and so on).
Each holds the GM percussion range, MIDI notes 35-81, as base64 mp3 keyed by
note name — the same format as the melodic packs, so one parser reads both.
