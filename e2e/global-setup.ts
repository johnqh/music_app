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
      `psql postgres://localhost:5432/music_test -c "TRUNCATE projects, ai_usage, generation_jobs CASCADE" -q`,
      {
        stdio: 'inherit',
      },
    );
  } catch {
    // Tables may not exist yet on a fresh database; music_api creates them on boot.
  }
}
