import { expect, test } from '@playwright/test';
import {
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  viewportPointForId,
  waitForNotation,
} from './helpers';

test.describe('drag to move notes', () => {
  test('Option+drag moves a note to another track', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Note Drag');
    await generateWholeScore(page, { prompt: 'Create a calm duet', measures: 4 });
    await waitForNotation(page);

    // Drag a note on track 0 onto a note that is already on track 1 — that
    // point is inside track 1's stave band by construction, so the test needs
    // no new introspection API.
    // Guarantee a second track rather than skipping when generation gives one:
    // a skipped test is a silent pass, and this test exists precisely to prove
    // a note can cross tracks.
    await page.evaluate(() => {
      type Track = Record<string, unknown> & { id: string; name: string };
      type Store = {
        getState: () => { score: { tracks: Track[] }; setScore: (s: unknown) => void };
      };
      const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
      const score = store.getState().score;
      if (score.tracks.length > 1) return;
      const base = score.tracks[0] as Track & {
        measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
      };
      const newId = `${base.id}-2`;
      // The events carry their own trackId, so a shallow copy of the track
      // would leave every note claiming to belong to the first one.
      const copy = {
        ...base,
        id: newId,
        name: 'Second',
        measures: base.measures.map((m) => ({
          ...m,
          id: `${String((m as unknown as { id: string }).id)}-2`,
          voices: m.voices.map((v) => ({
            ...v,
            id: `${String((v as unknown as { id: string }).id)}-2`,
            events: v.events.map((e) => ({
              ...e,
              id: `${String(e.id)}-2`,
              trackId: newId,
            })),
          })),
        })),
      };
      store.getState().setScore({ ...score, tracks: [base, copy] });
    });

    const summary = await readScoreSummary(page);
    const tracks = [...new Set((summary?.notes ?? []).map((n) => n.trackId))];
    expect(tracks.length).toBeGreaterThan(1);

    const source = summary!.notes.find((n) => n.trackId === tracks[0])!;
    const anchorOnTarget = summary!.notes.find((n) => n.trackId === tracks[1])!;

    const from = await viewportPointForId(page, 'idToBBox', source.id);
    const to = await viewportPointForId(page, 'idToBBox', anchorOnTarget.id);
    if (!from || !to) throw new Error('note not in the drawn window');

    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(page.getByTestId('drop-indicator')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Alt');

    // Assert the note's *identity*, not counts: the toolbar's edit mode is
    // `replace` by default, so track 1 displaces an occupant and its note
    // count is unchanged. Where this particular note now lives is the claim.
    const landedOn = await page.evaluate((noteId: string) => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: {
            getState: () => {
              score: {
                tracks: Array<{
                  id: string;
                  measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
                }>;
              };
            };
          };
        }
      ).__SCORESMITH_STORE__;
      const track = store
        .getState()
        .score.tracks.find((t) =>
          t.measures.some((m) => m.voices.some((v) => v.events.some((e) => e.id === noteId))),
        );
      return track?.id ?? null;
    }, source.id);

    expect(landedOn).toBe(tracks[1]);
  });
});
