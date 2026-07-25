/**
 * Truncates the e2e test database before the run so every suite starts
 * clean (projects + quota usage). Uses psql (local Postgres 15 via brew).
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  try {
    execSync(
      `psql postgres://localhost:5432/music_test -c "TRUNCATE projects, ai_usage" -q`,
      { stdio: 'inherit' }
    );
  } catch {
    // Tables may not exist yet on a fresh database; music_api creates them on boot.
  }
}
