/** Local midnight `daysAgo` days before `now` (the machine's time zone), as an ISO instant. */
export function startOfLocalDay(now: Date, daysAgo = 0): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return day.toISOString();
}

/** "YYYY-MM-DD" of the local calendar day, matching SQLite's date(…, 'localtime'). */
export function formatLocalDay(now: Date, daysAgo = 0): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/** The last `count` local days, oldest first, today last. */
export function listRecentLocalDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => formatLocalDay(now, count - 1 - index));
}
