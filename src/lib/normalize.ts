import { createHash } from "crypto";

/** Tag normalization per spec: lowercase, trim, collapse whitespace, strip punctuation. */
export function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 over whitespace-normalized text — duplicate-paste detection. */
export function sourceHash(rawSource: string): string {
  const normalized = rawSource.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Coerce a partial date to the full ISO form Postgres `date` columns accept.
 *
 * The extractor is asked for a date AND a precision, so answering "2023" with
 * precision "year" is the natural thing to write — but Postgres rejects it
 * outright ("invalid input syntax for type date"), which used to blow up an
 * entire apply. Precision is what records the vagueness; the column just
 * needs a real day.
 *
 *   "2023"        -> "2023-01-01"
 *   "2023-06"     -> "2023-06-01"
 *   "2023-Q3"     -> "2023-07-01"
 *   "2023-06-15"  -> unchanged
 *
 * Anything still unparseable returns null: dropping one bad date is always
 * better than losing the memory it was attached to.
 */
export function normalizeDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;

  // Full ISO date: keep, but only if it's a real calendar day. Postgres would
  // reject 2023-02-30, and Date rolls it over to March rather than erroring.
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (full) {
    const [, y, m, d] = full;
    const dt = new Date(`${v}T00:00:00Z`);
    const valid =
      !Number.isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() + 1 === Number(m) &&
      dt.getUTCDate() === Number(d);
    return valid ? v : null;
  }

  // Year and month: first of that month.
  const ym = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (ym) {
    const month = Number(ym[2]);
    if (month < 1 || month > 12) return null;
    return `${ym[1]}-${String(month).padStart(2, "0")}-01`;
  }

  // Quarter, as "2023-Q3" or "2023 Q3": first day of that quarter.
  const q = /^(\d{4})[-\s]?[Qq]([1-4])$/.exec(v);
  if (q) {
    const month = (Number(q[2]) - 1) * 3 + 1;
    return `${q[1]}-${String(month).padStart(2, "0")}-01`;
  }

  // Bare year: January 1st.
  const year = /^(\d{4})$/.exec(v);
  if (year) return `${year[1]}-01-01`;

  return null;
}
