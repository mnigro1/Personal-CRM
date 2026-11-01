/**
 * Timezone-aware date helpers.
 *
 * The server runs in UTC (Vercel), but every user carries their own IANA
 * timezone on their profile. A form's datetime-local value and every date we
 * print must be read and shown in THAT zone — using the server's zone put
 * evening interactions on the wrong calendar day for anyone west of Greenwich.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function wallClockParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // h23, not hour12:false — some engines print midnight as "24" otherwise.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** How far `timeZone` sits from UTC at the given instant, in ms. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const p = wallClockParts(new Date(utcMs), timeZone);
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - utcMs;
}

/**
 * Parse an `<input type="datetime-local">` value ("2026-10-31T21:30") as a
 * wall-clock time in `timeZone`. Input that already carries an offset or
 * zone is parsed as-is; anything unparseable returns null.
 */
export function zonedLocalToUtc(value: string, timeZone: string): Date | null {
  const v = value.trim();
  const m = WALL_CLOCK.exec(v);
  if (!m) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // The offset depends on the instant (DST), so refine once: the first
  // guess is within a few hours, and the offset at the guess is the real one.
  let guess = asIfUtc - tzOffsetMs(asIfUtc, timeZone);
  guess = asIfUtc - tzOffsetMs(guess, timeZone);
  return new Date(guess);
}

/** The inverse: an instant as the datetime-local value for `timeZone`. */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const p = wallClockParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Whether `Intl` knows this IANA zone name ("Europe/Paris"; not "EST"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "10/31/2026" in the user's zone. */
export function formatDate(date: Date | string, timeZone: string): string {
  return new Date(date).toLocaleDateString("en-US", { timeZone });
}

/** "10/31/2026, 9:30 PM" in the user's zone. */
export function formatDateTime(date: Date | string, timeZone: string): string {
  return new Date(date).toLocaleString("en-US", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}
