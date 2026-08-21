/**
 * How far from centre, and which side.
 *
 * "0.4" tells you neither without knowing the convention, and at the centre
 * there is no side to name at all — hence "C" rather than "L0".
 *
 * Its own module rather than a second export from `mixer-controls.tsx`: a file
 * that exports both components and plain functions loses fast refresh, so
 * editing a slider full-reloads the page instead of hot-updating it.
 */
export function panReadout(value: number): string {
  const amount = Math.round(Math.abs(value) * 100);
  if (amount === 0) return 'C';
  return `${value < 0 ? 'L' : 'R'}${amount}`;
}
