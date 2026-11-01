import { consumeRateLimit } from "@/db/rate-limit";
import { repoFor } from "@/db/repo";
import {
  contactsToCsv,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFileName,
  streamJsonExport,
} from "@/lib/export";
import { requireSession } from "@/lib/session";

/**
 * Settings → Your data → Download. The signed-in user's whole workspace as
 * one JSON file, or just their live contacts as a CSV (`?format=csv`). The
 * right to access, in product form: no ticket, no email, just the file.
 *
 * Gated by the session like every page (`requireSession` redirects to
 * /signin when there is none), rate-limited per user because each download
 * reads the entire workspace, and never cached: the file is personal data.
 */

export const maxDuration = 60;

// Three downloads in ten minutes is a person retrying; thirty is a script.
const EXPORT_LIMIT = { limit: 3, windowSeconds: 10 * 60 };

const fileHeaders = (contentType: string, filename: string) => ({
  "Content-Type": contentType,
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "no-store",
});

export async function GET(request: Request) {
  const { user, workspace } = await requireSession();
  const format = new URL(request.url).searchParams.get("format");

  const limit = await consumeRateLimit(`export:${user.id}`, EXPORT_LIMIT);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return new Response(
      `You've downloaded your data ${EXPORT_LIMIT.limit} times in the last ${EXPORT_LIMIT.windowSeconds / 60} minutes. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(limit.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const repo = repoFor(workspace.id);
  const now = new Date();

  if (format === "csv") {
    // Live contacts only: a spreadsheet is for using, not for archaeology.
    const rows = await repo.listContacts();
    return new Response(contactsToCsv(rows, user.timezone), {
      headers: fileHeaders(
        "text/csv; charset=utf-8",
        exportFileName("csv", now, user.timezone),
      ),
    });
  }

  const data = await repo.exportWorkspace();
  return new Response(
    streamJsonExport({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      profile: {
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        createdAt: user.createdAt,
        // The raw settings blob: drafting voice, goals, extraction mode.
        settings: user.settingsJson ?? {},
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
      },
      ...data,
    }),
    {
      headers: fileHeaders(
        "application/json; charset=utf-8",
        exportFileName("json", now, user.timezone),
      ),
    },
  );
}
