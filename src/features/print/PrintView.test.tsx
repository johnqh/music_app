import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CanvasScoreRenderer,
  computeLayout,
  createAppStore,
  PAGE_MARGIN_MM,
  rehearsalMarks,
  selectVisibleTrackIds,
  stressScore,
  testStoreContext,
  twoTrackScore,
  withRehearsalMarks,
} from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { printRenderOptions } from '@sudobility/music_drawing';
import { PrintView } from '@/features/print/PrintView';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twoTrackScore());
  return store;
}

const systemCount = (trackIds: string[] = []) =>
  computeLayout(twoTrackScore(), printRenderOptions(trackIds)).systems.length;

const printedSystems = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid^="print-system-"]');

describe('PrintView', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  it('renders every system of the score', () => {
    const store = makeStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(printedSystems(container)).toHaveLength(systemCount());
  });

  it('prints the whole score by default', () => {
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);
    expect(screen.getByLabelText('What to print')).toHaveTextContent('Whole score');
  });

  it('no longer warns about a single track at all', async () => {
    // Transposition and multi-measure rests were the two things that made a
    // filtered track less than a part. Both have landed, so the caveat has
    // nothing left to say.
    const user = userEvent.setup();
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);

    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();
    expect(screen.queryByText(/concert pitch/i)).toBeNull();
    expect(screen.queryByText(/bar of rest/i)).toBeNull();
  });

  it('calls print when asked', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintView store={store} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('goes back to the editor', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const onBack = vi.fn();
    render(<PrintView store={store} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('says so plainly when there is no score', () => {
    const store = createAppStore({ context: testStoreContext() }) as EditorStoreApi;
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(printedSystems(container)).toHaveLength(0);
    expect(screen.getByText(/nothing to print/i)).toBeInTheDocument();
  });
});

describe('a part is written for its instrument', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  /** A two-track score whose first track is a B-flat clarinet. */
  function clarinetStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    const score = twoTrackScore();
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t, i) =>
        i === 0 ? { ...t, midiProgram: 71, instrumentName: 'Clarinet' } : t,
      ),
    });
    return store;
  }

  const pitchesInStore = (store: EditorStoreApi) =>
    store
      .getState()
      .score!.tracks[0].measures[0].voices[0].events.filter((e) => 'pitch' in e)
      .map((e) => JSON.stringify((e as { pitch: unknown }).pitch));

  it('no longer warns about concert pitch', async () => {
    // Asserted with a track actually selected: the caveat only renders then,
    // so checking it on the default view would pass without proving anything.
    const user = userEvent.setup();
    const store = clarinetStore();
    render(<PrintView store={store} onBack={() => {}} />);

    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();
    expect(screen.queryByText(/concert pitch/i)).toBeNull();
  });

  it('leaves the score in the store at concert pitch', async () => {
    // The guard that matters: printing a transposed part must not transpose
    // the music. That failure would be silent.
    const user = userEvent.setup();
    const store = clarinetStore();
    const before = pitchesInStore(store);

    render(<PrintView store={store} onBack={() => {}} />);
    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(pitchesInStore(store)).toEqual(before);
  });

  it('still renders systems for the transposed part', () => {
    // Transposition must not quietly produce an empty part.
    const store = clarinetStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(container.querySelectorAll('[data-testid^="print-system-"]').length).toBeGreaterThan(0);
  });
});

describe('print-only derivations', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  /** A 40-bar two-track score, long enough to earn regular marks. */
  function longStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    return store;
  }

  /** Every string drawn into any canvas rendered under `container`. */
  function drawnText(container: HTMLElement): string[] {
    return [...container.querySelectorAll('canvas')].flatMap((canvas) => {
      const ctx = canvas.getContext('2d') as unknown as {
        ops: { method: string; args: unknown[] }[];
      };
      return ctx.ops.filter((op) => op.method === 'fillText').map((op) => String(op.args[0]));
    });
  }

  it('draws the marks onto the whole-score print', () => {
    // System count cannot tell marked from unmarked — collapsing only happens
    // in a part — so assert the letters themselves reach the page.
    const store = longStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    const expected = [...rehearsalMarks(store.getState().score!).values()];
    expect(expected.length).toBeGreaterThan(0);
    for (const label of expected) {
      expect(drawnText(container)).toContain(label);
    }
  });

  /**
   * A two-track score where track 0 rests bars 2..30 and track 1 plays
   * throughout — long enough that track 0's part earns a cue from track 1.
   * Track 1 is renamed to something no other text can be, so finding it in the
   * drawn output means a cue label and nothing else: print sets
   * `showTrackInfo: false`, so track names are never otherwise drawn.
   */
  const CUE_SOURCE_NAME = 'Zzcue';

  function cueableStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    const base = stressScore(2, 40);
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t, i) =>
        i === 0
          ? {
              ...t,
              measures: t.measures.map((m, j) => (j >= 1 && j <= 29 ? { ...m, voices: [] } : m)),
            }
          : { ...t, name: CUE_SOURCE_NAME },
      ),
    });
    return store;
  }

  it('puts no cues in the whole-score print', () => {
    // A conductor is already looking at every part. This is the one place the
    // cue rule differs from the mark rule, so it is worth pinning.
    const { container } = render(<PrintView store={cueableStore()} onBack={() => {}} />);
    expect(drawnText(container)).not.toContain(CUE_SOURCE_NAME);
  });

  it('puts a cue in the part print, which is what makes the test above mean something', async () => {
    // The positive control. Without it, "no cue label drawn" would pass just as
    // well on a fixture that could never produce a cue at all.
    const user = userEvent.setup();
    const store = cueableStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(drawnText(container)).toContain(CUE_SOURCE_NAME);
  });

  it('draws notes under an octave bracket where they are written', () => {
    // The model stores sounding pitch; an `8va` note is written an octave
    // below it. The print view drew the stored score, so a bracketed passage
    // printed an octave high under its own bracket.
    const store = createAppStore({ context: testStoreContext() });
    const base = twoTrackScore();
    const first = base.tracks[0].measures[0].voices[0].events.find((e) => 'pitch' in e)!;
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t, i) =>
        i !== 0
          ? t
          : {
              ...t,
              measures: t.measures.map((m, j) =>
                j !== 0
                  ? m
                  : {
                      ...m,
                      voices: m.voices.map((v, k) =>
                        k !== 0
                          ? v
                          : {
                              ...v,
                              events: v.events.map((e) =>
                                e.id === first.id
                                  ? { ...e, ottavaStart: '8va', ottavaStop: true }
                                  : e,
                              ),
                            },
                      ),
                    },
              ),
            },
      ),
    } as never);
    const render_ = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    render(<PrintView store={store} onBack={() => {}} />);
    const drawn = render_.mock.calls[0]![0] as ReturnType<typeof twoTrackScore>;
    const drawnFirst = drawn.tracks[0].measures[0].voices[0].events.find((e) => e.id === first.id);
    const stored = (first as { pitch: { octave: number } }).pitch.octave;
    expect((drawnFirst as { pitch: { octave: number } }).pitch.octave).toBe(stored - 1);
    render_.mockRestore();
  });

  it('leaves the score in the store unmarked', () => {
    // Marks are print-only. One that cannot be moved would be a control that
    // looks editable and is not.
    const store = longStore();
    render(<PrintView store={store} onBack={() => {}} />);
    const marked = store
      .getState()
      .score!.tracks.flatMap((t) => t.measures)
      .some((m) => m.rehearsalMark !== undefined);
    expect(marked).toBe(false);
  });
});

describe('pagination', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  const pageBlocks = (container: HTMLElement) =>
    container.querySelectorAll('[data-testid^="print-page-"]');

  function bigStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    return store;
  }

  it('groups systems into page blocks', () => {
    // Feature 1 had no pages at all — every system was a sibling and the
    // browser decided. A page block is what makes the break ours.
    const { container } = render(<PrintView store={bigStore()} onBack={() => {}} />);
    expect(pageBlocks(container).length).toBeGreaterThan(1);
  });

  it('repaginates when the paper changes', async () => {
    // A landscape page is shorter, so the same score needs more of them. This
    // is the observable point of the picker.
    const user = userEvent.setup();
    const { container } = render(<PrintView store={bigStore()} onBack={() => {}} />);

    const portraitPages = pageBlocks(container).length;

    await user.click(screen.getByLabelText('Orientation'));
    await user.click(screen.getByRole('option', { name: 'Landscape' }));

    expect(pageBlocks(container).length).toBeGreaterThan(portraitPages);
  });

  it('starts on the paper the browser region prints on', () => {
    // jsdom reports en-US, which prints on Letter.
    render(<PrintView store={bigStore()} onBack={() => {}} />);
    expect(screen.getByLabelText('Paper')).toHaveTextContent('Letter');
  });

  it('starts on a remembered paper instead, once one has been chosen', () => {
    const store = bigStore();
    store.getState().setPaperSize('a4');
    render(<PrintView store={store} onBack={() => {}} />);
    expect(screen.getByLabelText('Paper')).toHaveTextContent('A4');
  });

  it('emits an @page rule matching the chosen paper', () => {
    // The printer and the packer must agree about the page, or the pages we
    // chose are not the pages that come out.
    const store = bigStore();
    store.getState().setPaperSize('a4');
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    const style = container.querySelector('style');
    expect(style?.textContent).toContain('size: A4 portrait');
    expect(style?.textContent).toContain(`margin: ${PAGE_MARGIN_MM}mm`);
  });

  it('prints every system exactly once across the pages', () => {
    // The invariant a pagination bug breaks first.
    const store = bigStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    const expected = computeLayout(
      withRehearsalMarks(store.getState().score!),
      printRenderOptions(selectVisibleTrackIds(store.getState())),
    ).systems.length;

    expect(container.querySelectorAll('[data-testid^="print-system-"]')).toHaveLength(expected);
  });
});
