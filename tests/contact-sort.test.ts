import { describe, expect, it } from "vitest";
import {
  nextSortState,
  parseSortState,
  sortContacts,
  type SortableContact,
} from "@/lib/contact-sort";

const mk = (
  firstName: string,
  over: Partial<SortableContact> = {},
): SortableContact & { id: string } => ({
  id: firstName,
  firstName,
  lastName: null,
  preferredName: null,
  currentCompany: null,
  currentRole: null,
  lastInteractionDate: null,
  ...over,
});

const names = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("nextSortState — standard three-state cycle", () => {
  it("none → asc → desc → none on the same column", () => {
    const s1 = nextSortState(null, "name");
    expect(s1).toEqual({ key: "name", dir: "asc" });
    const s2 = nextSortState(s1, "name");
    expect(s2).toEqual({ key: "name", dir: "desc" });
    const s3 = nextSortState(s2, "name");
    expect(s3).toBeNull();
  });

  it("clicking a different column starts that column at asc", () => {
    const s = nextSortState({ key: "name", dir: "desc" }, "company");
    expect(s).toEqual({ key: "company", dir: "asc" });
  });
});

describe("parseSortState", () => {
  it("ignores unknown keys and defaults dir to asc", () => {
    expect(parseSortState("bogus", "desc")).toBeNull();
    expect(parseSortState(undefined, "desc")).toBeNull();
    expect(parseSortState("name", undefined)).toEqual({ key: "name", dir: "asc" });
    expect(parseSortState("last", "desc")).toEqual({ key: "last", dir: "desc" });
  });
});

describe("sortContacts", () => {
  const zero = () => 0;

  it("returns the original order when unsorted", () => {
    const rows = [mk("Zed"), mk("Amy")];
    expect(names(sortContacts(rows, null, zero))).toEqual(["Zed", "Amy"]);
  });

  it("sorts by display name, case-insensitively, using preferred name", () => {
    const rows = [
      mk("Zed"),
      mk("amy"),
      mk("Robert", { preferredName: "Bob" }),
    ];
    expect(names(sortContacts(rows, { key: "name", dir: "asc" }, zero))).toEqual([
      "amy", "Robert", "Zed",
    ]);
    expect(names(sortContacts(rows, { key: "name", dir: "desc" }, zero))).toEqual([
      "Zed", "Robert", "amy",
    ]);
  });

  it("puts empty company/role last in BOTH directions", () => {
    const rows = [
      mk("NoCompany"),
      mk("Beta", { currentCompany: "Beta Corp" }),
      mk("Alpha", { currentCompany: "Alpha Inc" }),
    ];
    expect(names(sortContacts(rows, { key: "company", dir: "asc" }, zero))).toEqual([
      "Alpha", "Beta", "NoCompany",
    ]);
    expect(names(sortContacts(rows, { key: "company", dir: "desc" }, zero))).toEqual([
      "Beta", "Alpha", "NoCompany",
    ]);
  });

  it("sorts last interaction as dates, never-contacted last", () => {
    const rows = [
      mk("Never"),
      mk("Old", { lastInteractionDate: "2026-01-01T00:00:00Z" }),
      mk("Recent", { lastInteractionDate: new Date("2026-10-01T00:00:00Z") }),
    ];
    expect(names(sortContacts(rows, { key: "last", dir: "desc" }, zero))).toEqual([
      "Recent", "Old", "Never",
    ]);
    expect(names(sortContacts(rows, { key: "last", dir: "asc" }, zero))).toEqual([
      "Old", "Recent", "Never",
    ]);
  });

  it("sorts follow-up counts numerically with zero treated as empty", () => {
    const rows = [mk("None"), mk("Two"), mk("Ten"), mk("One")];
    const counts: Record<string, number> = { Two: 2, Ten: 10, One: 1 };
    const count = (c: { id: string }) => counts[c.id] ?? 0;
    expect(names(sortContacts(rows, { key: "followups", dir: "desc" }, count))).toEqual([
      "Ten", "Two", "One", "None",
    ]);
    // Numeric, not lexical: 10 must not sort between 1 and 2.
    expect(names(sortContacts(rows, { key: "followups", dir: "asc" }, count))).toEqual([
      "One", "Two", "Ten", "None",
    ]);
  });

  it("does not mutate the input", () => {
    const rows = [mk("B"), mk("A")];
    sortContacts(rows, { key: "name", dir: "asc" }, zero);
    expect(names(rows)).toEqual(["B", "A"]);
  });
});
