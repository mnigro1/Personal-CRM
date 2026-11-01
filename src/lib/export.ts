import type { contacts } from "@/db/schema";
import { utcToZonedLocal } from "@/lib/dates";

/**
 * Pure formatting for the Settings → Your data downloads. No database access
 * here: the route hands in rows it got from the repo, and these turn them
 * into bytes.
 */

export const EXPORT_FORMAT = "personal-crm-export";
export const EXPORT_VERSION = 1;

/** "personal-crm-export-2026-10-31.json", dated in the user's own zone. */
export function exportFileName(
  kind: "json" | "csv",
  now: Date,
  timeZone: string,
): string {
  const day = utcToZonedLocal(now, timeZone).slice(0, 10);
  return kind === "csv"
    ? `personal-crm-contacts-${day}.csv`
    : `personal-crm-export-${day}.json`;
}

// ----------------------------------------------------------------------- JSON

const encoder = new TextEncoder();

/**
 * JSON-encode `payload` as a stream: every top-level array goes out one row
 * per chunk, everything else in a chunk of its own. The response starts
 * flowing before the last row is encoded, the server never holds the whole
 * file as one string, and the output is one row per line so it greps.
 */
export function streamJsonExport(
  payload: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  async function* chunks() {
    yield "{\n";
    const entries = Object.entries(payload);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const tail = i === entries.length - 1 ? "\n" : ",\n";
      const name = JSON.stringify(key);
      if (Array.isArray(value)) {
        yield `  ${name}: [`;
        for (let j = 0; j < value.length; j++) {
          yield `${j === 0 ? "\n" : ",\n"}    ${JSON.stringify(value[j] ?? null)}`;
        }
        yield `${value.length > 0 ? "\n  " : ""}]${tail}`;
      } else {
        const json = JSON.stringify(value ?? null, null, 2).replace(
          /\n/g,
          "\n  ",
        );
        yield `  ${name}: ${json}${tail}`;
      }
    }
    yield "}\n";
  }

  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    cancel() {
      void iterator.return(undefined);
    },
  });
}

// ------------------------------------------------------------------------ CSV

type ContactRow = typeof contacts.$inferSelect;

type CsvColumn = {
  header: string;
  value: (c: ContactRow, timeZone: string) => string | null | undefined;
};

/** The spreadsheet view of a contact. Column order is the order here. */
export const CONTACT_CSV_COLUMNS: readonly CsvColumn[] = [
  { header: "First name", value: (c) => c.firstName },
  { header: "Last name", value: (c) => c.lastName },
  { header: "Preferred name", value: (c) => c.preferredName },
  { header: "Emails", value: (c) => c.emails.join("; ") },
  { header: "Phone", value: (c) => c.phone },
  { header: "Company", value: (c) => c.currentCompany },
  { header: "Role", value: (c) => c.currentRole },
  { header: "Location", value: (c) => c.location },
  { header: "LinkedIn", value: (c) => c.linkedinUrl },
  { header: "Website", value: (c) => c.website },
  { header: "How we met", value: (c) => c.howWeMet },
  { header: "Date first met", value: (c) => c.dateFirstMet },
  { header: "Category", value: (c) => c.relationshipCategory },
  { header: "Notes", value: (c) => c.notes },
  {
    header: "Last interaction",
    value: (c, timeZone) =>
      c.lastInteractionDate
        ? utcToZonedLocal(c.lastInteractionDate, timeZone).slice(0, 10)
        : null,
  },
];

const FORMULA_START = /^[=+\-@\t\r]/;
const LOOKS_NUMERIC = /^[+-]?[\d\s().-]+$/;

/**
 * One CSV field, RFC 4180 style: quoted when it holds a quote, comma or line
 * break, with inner quotes doubled.
 *
 * Also neutralizes spreadsheet formula injection. Excel and Sheets run a cell
 * that starts with "=", "+", "-" or "@" when the file opens, and notes can
 * carry text pasted from anyone. A leading apostrophe marks it as text.
 * Phone numbers ("+1 555 ...") are exempt: pure digits can't be a formula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let v = String(value);
  if (v === "") return "";
  if (FORMULA_START.test(v) && !LOOKS_NUMERIC.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * One row per contact, CRLF line ends, and a UTF-8 byte-order mark so Excel
 * reads accented names as UTF-8 instead of guessing a legacy code page.
 */
export function contactsToCsv(
  rows: readonly ContactRow[],
  timeZone: string,
): string {
  const lines = [CONTACT_CSV_COLUMNS.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(
      CONTACT_CSV_COLUMNS.map((c) => csvCell(c.value(row, timeZone))).join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
