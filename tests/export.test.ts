import { describe, expect, it } from "vitest";
import type { contacts } from "@/db/schema";
import {
  CONTACT_CSV_COLUMNS,
  contactsToCsv,
  csvCell,
  exportFileName,
  streamJsonExport,
} from "@/lib/export";

type ContactRow = typeof contacts.$inferSelect;

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: "c1",
  workspaceId: "w1",
  firstName: "Ada",
  lastName: "Lovelace",
  preferredName: null,
  emails: ["ada@example.test", "ada@work.test"],
  phone: "+1 (555) 010-2000",
  currentCompany: "Analytical Engines, Ltd.",
  currentRole: null,
  location: "London",
  linkedinUrl: null,
  website: null,
  howWeMet: 'She said "hello"',
  dateFirstMet: "1843-06-01",
  relationshipCategory: "friend",
  notes: "Line one\nLine two",
  lastInteractionDate: new Date("2026-10-31T23:30:00Z"),
  aiSummary: null,
  aiSummaryStale: false,
  aiSummaryGeneratedAt: null,
  mergedIntoContactId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  ...over,
});

describe("csvCell", () => {
  it("leaves plain text alone and blanks out nothing", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("quotes commas, quotes and line breaks the RFC 4180 way", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
  });

  it("neutralizes cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("@handle")).toBe("'@handle");
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    // Numbers that merely start with a sign are not formulas.
    expect(csvCell("+1 (555) 010-2000")).toBe("+1 (555) 010-2000");
    expect(csvCell("-5")).toBe("-5");
  });
});

describe("contactsToCsv", () => {
  it("writes a BOM, the documented header, and one CRLF row per contact", () => {
    const csv = contactsToCsv(
      [contact(), contact({ id: "c2", firstName: "Bob", lastName: null, emails: [], lastInteractionDate: null })],
      "America/New_York",
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines.at(-1)).toBe(""); // trailing newline
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "First name,Last name,Preferred name,Emails,Phone,Company,Role,Location,LinkedIn,Website,How we met,Date first met,Category,Notes,Last interaction",
    );
    expect(lines[0].split(",")).toHaveLength(CONTACT_CSV_COLUMNS.length);
    expect(lines[1]).toBe(
      'Ada,Lovelace,,ada@example.test; ada@work.test,+1 (555) 010-2000,"Analytical Engines, Ltd.",,London,,,"She said ""hello""",1843-06-01,friend,"Line one\nLine two",2026-10-31',
    );
    expect(lines[2]).toBe("Bob,,,,+1 (555) 010-2000,\"Analytical Engines, Ltd.\",,London,,,\"She said \"\"hello\"\"\",1843-06-01,friend,\"Line one\nLine two\",");
  });

  it("dates the last interaction in the user's zone, not the server's", () => {
    // 23:30 UTC on Oct 31 is still Oct 31 in New York but already Nov 1 in Tokyo.
    expect(contactsToCsv([contact()], "America/New_York")).toContain(",2026-10-31\r\n");
    expect(contactsToCsv([contact()], "Asia/Tokyo")).toContain(",2026-11-01\r\n");
  });
});

describe("streamJsonExport", () => {
  it("streams valid JSON with top-level arrays one row per line", async () => {
    const payload = {
      format: "personal-crm-export",
      version: 1,
      exportedAt: new Date("2026-10-31T12:00:00Z"),
      profile: { email: "a@example.test", settings: { goals: { introsPerMonth: 2 } } },
      empty: [],
      rows: [{ id: "r1", when: new Date("2026-01-01T00:00:00Z") }, { id: "r2", note: 'quote " and \n newline' }],
    };
    const text = await new Response(streamJsonExport(payload)).text();
    expect(JSON.parse(text)).toEqual({
      format: "personal-crm-export",
      version: 1,
      exportedAt: "2026-10-31T12:00:00.000Z",
      profile: { email: "a@example.test", settings: { goals: { introsPerMonth: 2 } } },
      empty: [],
      rows: [{ id: "r1", when: "2026-01-01T00:00:00.000Z" }, { id: "r2", note: 'quote " and \n newline' }],
    });
    expect(text).toContain('\n    {"id":"r1"');
    expect(text).toContain('\n    {"id":"r2"');
    expect(text).toContain('"empty": []');
  });

  it("handles an empty payload and undefined values", async () => {
    expect(JSON.parse(await new Response(streamJsonExport({})).text())).toEqual({});
    expect(
      JSON.parse(await new Response(streamJsonExport({ a: undefined, b: [undefined] })).text()),
    ).toEqual({ a: null, b: [null] });
  });
});

describe("exportFileName", () => {
  it("dates the file in the user's zone", () => {
    const at = new Date("2026-10-31T23:30:00Z");
    expect(exportFileName("json", at, "America/New_York")).toBe("personal-crm-export-2026-10-31.json");
    expect(exportFileName("json", at, "Asia/Tokyo")).toBe("personal-crm-export-2026-11-01.json");
    expect(exportFileName("csv", at, "UTC")).toBe("personal-crm-contacts-2026-10-31.csv");
  });
});
