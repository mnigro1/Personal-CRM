/**
 * Column sorting for the contacts list. Pure functions so the three-state
 * cycle and the empties-last rule are unit-testable without a database.
 *
 * Convention: click once → ascending, again → descending, again → back to
 * the default order. Empty values always sort last in both directions so a
 * column of blanks never floats to the top.
 */

export const SORT_KEYS = ["name", "company", "last", "followups"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir } | null;

export function parseSortState(
  sort: string | undefined,
  dir: string | undefined,
): SortState {
  if (!sort || !(SORT_KEYS as readonly string[]).includes(sort)) return null;
  return { key: sort as SortKey, dir: dir === "desc" ? "desc" : "asc" };
}

/** The state a header click moves to: none → asc → desc → none. */
export function nextSortState(current: SortState, clicked: SortKey): SortState {
  if (!current || current.key !== clicked) return { key: clicked, dir: "asc" };
  if (current.dir === "asc") return { key: clicked, dir: "desc" };
  return null;
}

export type SortableContact = {
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  lastInteractionDate: Date | string | null;
};

const displayName = (c: SortableContact) =>
  `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim();

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function sortContacts<T extends SortableContact>(
  rows: T[],
  state: SortState,
  followUpCount: (c: T) => number,
): T[] {
  if (!state) return rows;
  const sign = state.dir === "desc" ? -1 : 1;

  // Each key yields a comparable value, or null when the cell is empty.
  const valueOf = (c: T): string | number | null => {
    switch (state.key) {
      case "name":
        return displayName(c) || null;
      case "company": {
        const v = [c.currentCompany, c.currentRole].filter(Boolean).join(" ");
        return v || null;
      }
      case "last":
        return c.lastInteractionDate
          ? new Date(c.lastInteractionDate).getTime()
          : null;
      case "followups": {
        const n = followUpCount(c);
        return n > 0 ? n : null;
      }
    }
  };

  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    // Empties last regardless of direction — not multiplied by sign.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : collator.compare(String(av), String(bv));
    return cmp * sign;
  });
}
