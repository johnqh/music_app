/**
 * Live generation: a job's result reaches the open editor over its WebSocket,
 * the editor is locked but not covered while the job runs, and what the
 * stream leaves in the store is exactly what `GET /projects/:id` returns.
 *
 * A Replace job rather than a whole-score one: the fixture provider answers
 * whole-score generation in microseconds, and `AI_TEST_DELAY_MS` slows only
 * regeneration, which is what makes the locked state observable at all.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  generateWholeScore,
  readScoreSummary,
  selectMeasuresByIndex,
  waitForGenerationSettled,
} from './helpers';

const API_URL = 'http://localhost:8023';

type ServerScore = {
  tracks: Array<{
    measures: Array<{
      id: string;
      index: number;
      startTick: number;
      durationTicks: number;
      voices: Array<{ events: Array<Record<string, unknown>> }>;
    }>;
  }>;
};

/** The same flattening `readScoreSummary` does in the page, for the server's copy. */
function summarise(score: ServerScore) {
  const notes: Array<Record<string, unknown>> = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if ('pitch' in event) {
            notes.push({
              id: event.id,
              pitch: event.pitch,
              startTick: event.startTick,
              durationTicks: event.durationTicks,
              velocity: event.velocity,
              trackId: event.trackId,
            });
          }
        }
      }
    }
  }
  notes.sort((a, b) => (a.startTick as number) - (b.startTick as number));
  return {
    trackCount: score.tracks.length,
    measureCount: score.tracks[0]?.measures.length ?? 0,
    notes,
    measures: (score.tracks[0]?.measures ?? []).map((m) => ({
      id: m.id,
      index: m.index,
      startTick: m.startTick,
      durationTicks: m.durationTicks,
    })),
  };
}

test.describe('live generation', () => {
  test('streams a job into the locked editor and leaves the store equal to the server', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);

    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });
    const projectId = page.url().split('/project/')[1]!.split(/[/?#]/)[0]!;
    const before = await readScoreSummary(page);

    // Registered before the job starts: the socket opens the moment the
    // editor learns the job id.
    const socketUrls: string[] = [];
    const frameTypes: string[] = [];
    page.on('websocket', (ws) => {
      socketUrls.push(ws.url());
      ws.on('framereceived', (frame) => {
        try {
          frameTypes.push((JSON.parse(String(frame.payload)) as { type: string }).type);
        } catch {
          frameTypes.push('<unreadable>');
        }
      });
    });

    await selectMeasuresByIndex(page, [1, 2]);
    await page.getByRole('tab', { name: 'Bar' }).click();
    await page.getByRole('button', { name: 'Replace Bars' }).click();
    await page.getByLabel('Instruction', { exact: true }).fill('Make this more dramatic');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();

    // Locked, not covered: the strip says so, the sheet and the transport are
    // still there to look at, Play is off and the editing toolbar is gone.
    const strip = page.getByTestId('generation-status-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByText('Generating notes…')).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Playback transport' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
    await expect(page.getByRole('toolbar', { name: 'Score editor toolbar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Nothing to undo|Undo/ })).toBeDisabled();

    // The stream: opened for this job, a snapshot first, a terminal message last.
    await expect
      .poll(() => socketUrls.find((url) => /\/api\/v1\/projects\/[^/]+\/live$/.test(url)) ?? null, {
        timeout: 15_000,
      })
      .not.toBeNull();
    await expect.poll(() => frameTypes[0] ?? null, { timeout: 15_000 }).toBe('snapshot');

    await waitForGenerationSettled(page);
    expect(frameTypes).toContain('complete');

    // Unlocked again, with the toolbar back.
    await expect(page.getByRole('toolbar', { name: 'Score editor toolbar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 60_000 });

    // The store holds exactly what the server does — the requirement the
    // whole mechanism is measured against.
    const response = await page.request.get(`${API_URL}/api/v1/projects/${projectId}`, {
      headers: { Authorization: 'Bearer e2e-token' },
    });
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { success: boolean; data: { score: ServerScore } };
    expect(body.success).toBe(true);
    const inStore = await readScoreSummary(page);
    expect(inStore).toEqual(summarise(body.data.score));
    // And it is the job's result, not the placeholder or the old bars.
    expect(inStore!.notes).not.toEqual(before!.notes);

    expect(getErrors()).toEqual([]);
  });
});
