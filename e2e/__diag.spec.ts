/** Local shape for the dev/e2e-only introspection handle this diagnostic reads. */
type DiagWindow = Window & {
  __scoresmith?: {
    result?: { plan?: { trackLayouts?: unknown[]; totalHeight?: number } };
  };
  __calls?: Array<Record<string, unknown>>;
};

import { test } from '@playwright/test';
import { generateWholeScore, waitForNotation, startPlayback } from './helpers';

test('open a many-track project and play, touching nothing', async ({ page }) => {
  const title = await generateWholeScore(page, { prompt: 'A piece', measures: 32 });

  // Build a tall score: 9 extra staves.
  for (let i = 0; i < 9; i += 1) {
    await page.getByLabel('Add Track').click();
    await page.getByRole('option', { name: 'Blank Track' }).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2500); // let the autosave flush

  // Leave, then reopen from the Projects screen — the user's exact flow.
  await page.goto('/en/projects');
  await page.getByRole('button', { name: `Open project: ${title}`, exact: true }).click();
  await page.waitForURL(/\/project\//);
  await waitForNotation(page);
  await page.waitForTimeout(1500);

  const box = page.getByTestId('score-editor-scroll');
  console.log(
    'GEOM ' +
      JSON.stringify(
        await box.evaluate((el) => ({
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          canScroll: el.scrollHeight > el.clientHeight,
          spacerH: (el.firstElementChild as HTMLElement)?.style?.height,
          tracks: (window as DiagWindow).__scoresmith?.result?.plan?.trackLayouts?.length,
          totalHeight: (window as DiagWindow).__scoresmith?.result?.plan?.totalHeight,
        })),
      ),
  );

  await box.evaluate((el) => {
    (window as DiagWindow).__calls = [];
    const orig = el.scrollTo.bind(el);
    (el as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (
      o: ScrollToOptions,
    ) => {
      (window as DiagWindow).__calls?.push({ ...o, from: el.scrollTop });
      return orig(o);
    };
  });

  // NO interaction with the sheet before playing.
  await startPlayback(page);
  const samples: unknown[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(1200);
    samples.push(
      await box.evaluate((el) => ({
        st: el.scrollTop,
        caret: (document.querySelector('[data-testid=playback-caret]') as HTMLElement)?.style
          .transform,
      })),
    );
  }
  console.log('SAMPLES ' + JSON.stringify(samples));
  console.log('CALLS ' + JSON.stringify(await page.evaluate(() => (window as DiagWindow).__calls)));
});
