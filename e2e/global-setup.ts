/**
 * Truncates the e2e test database before the run so every suite starts
 * clean (projects + quota usage). Uses psql (local Postgres 15 via brew).
 *
 * CASCADE because `snapshots` and `generation_jobs` reference `projects`:
 * `generation_jobs` is named explicitly anyway, so a future change dropping
 * that foreign key fails here loudly instead of leaking rows between runs.
 *
 * Without CASCADE the TRUNCATE
 * fails outright and every run inherits the last one'''s projects, which shows
 * up much later as a strict-mode violation on a duplicated project name.
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  try {
    execSync(
      `psql postgres://localhost:5432/music_test -c "TRUNCATE projects, ai_usage, generation_jobs, consumable_balances, consumable_purchases, consumable_usages CASCADE" -q`,
      {
        stdio: 'inherit',
      },
    );
  } catch (error) {
    /*
      A fresh database has none of these tables yet — music_api creates them on
      boot — so a failure here is expected exactly once and fatal never.

      But it is *reported*, because swallowing it silently turns a dirty
      database into a confusing failure much later and somewhere else: the run
      proceeds, inherits the last one's rows, and surfaces as a 500 from a
      unique-constraint violation inside whichever spec happens to touch that
      table first. Which is precisely how it presented.
    */
    console.warn(
      '[e2e] could not truncate the test database; the run may inherit ' +
        'rows from the last one. If a spec fails with a 500 and a duplicate ' +
        'key, this is why.',
      error instanceof Error ? error.message : error,
    );
  }
}
