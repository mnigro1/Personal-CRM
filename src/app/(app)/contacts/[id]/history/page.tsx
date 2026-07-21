import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { repoFor } from "@/db/repo";
import type { revisions } from "@/db/schema";
import { requireSession } from "@/lib/session";

type Revision = typeof revisions.$inferSelect;

const SOURCE_LABEL: Record<Revision["changeSource"], string> = {
  user: "you",
  ai_applied: "AI (approved)",
  ai_auto: "AI (auto)",
  undo: "undo",
};

function shortValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return shortValue(o.text);
    if (typeof o.description === "string") return shortValue(o.description);
    if (typeof o.tagName === "string") return o.tagName;
    if (typeof o.firstName === "string")
      return `${o.firstName} ${o.lastName ?? ""}`.trim();
    if (typeof o.status === "string") return o.status;
    return JSON.stringify(v).slice(0, 80);
  }
  return String(v);
}

function describe(r: Revision): string {
  const entity = r.entityType.replace(/_/g, " ");
  if (!r.field) {
    if (r.oldValue === null && r.newValue !== null)
      return `${entity} added: "${shortValue(r.newValue)}"`;
    if (r.newValue === null && r.oldValue !== null)
      return `${entity} deleted: "${shortValue(r.oldValue)}"`;
    return `${entity} changed`;
  }
  if (r.field === "supersession") {
    const reason = (r.newValue as { reason?: string } | null)?.reason;
    if (r.changeSource === "undo") return "memory restored to current";
    return reason ? `memory superseded — ${reason}` : "memory superseded";
  }
  if (r.field === "last_confirmed_at") return "memory re-confirmed";
  if (r.field === "tag") return `tag ${r.newValue ? "added" : "removed"}: ${shortValue(r.newValue ?? r.oldValue)}`;
  if (r.field === "contact")
    return `linked contacts changed`;
  return `${entity} ${r.field.replace(/_/g, " ")}: ${shortValue(r.oldValue)} → ${shortValue(r.newValue)}`;
}

export default async function ContactHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const contact = await repo.getContact(id);
  if (!contact) notFound();

  const revisionRows = await repo.getRevisionsForContact(id);
  const archivedMemories = contact.memories.filter(
    (m) => m.status !== "current",
  );
  const closedFollowUps = contact.followUps.filter((f) => f.status !== "open");

  const name = `${contact.preferredName ?? contact.firstName} ${contact.lastName ?? ""}`.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">History — {name}</h1>
          <p className="text-sm text-muted-foreground">
            Nothing here is ever deleted; this is the full archive.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/contacts/${contact.id}`} />}
        >
          Back to contact
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Archived memories</CardTitle>
          <CardDescription>
            Superseded and historical facts — how the relationship evolved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {archivedMemories.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing archived yet.
            </p>
          )}
          {archivedMemories.map((m) => {
            const replacement = m.supersededByMemoryId
              ? contact.memories.find((x) => x.id === m.supersededByMemoryId)
              : null;
            return (
              <div key={m.id} className="rounded border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground line-through">
                    {m.text}
                  </span>
                  <Badge variant="secondary">{m.status}</Badge>
                </div>
                {replacement && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    → now: {replacement.text}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.category}
                  {m.learnedAt && ` · learned ${m.learnedAt}`}
                  {m.eventDate && ` · event ${m.eventDate}`}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Completed follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {closedFollowUps.length === 0 && (
            <p className="text-sm text-muted-foreground">None yet.</p>
          )}
          {closedFollowUps.map((f) => (
            <div key={f.id} className="rounded border p-3 text-sm">
              <p>{f.description}</p>
              <p className="text-xs text-muted-foreground">
                {f.reason} · {f.status}
                {f.completedAt &&
                  ` · ${new Date(f.completedAt).toLocaleDateString()}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change log</CardTitle>
          <CardDescription>
            Every change that ever touched this contact — AI applies, your
            edits, and undos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revisionRows.length === 0 && (
            <p className="text-sm text-muted-foreground">No changes logged.</p>
          )}
          <ul className="space-y-1">
            {revisionRows.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline gap-2 border-b py-1.5 text-sm last:border-b-0"
              >
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                <Badge
                  variant={r.changeSource === "undo" ? "outline" : "secondary"}
                  className="shrink-0"
                >
                  {SOURCE_LABEL[r.changeSource]}
                </Badge>
                <span className="min-w-0">{describe(r)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
