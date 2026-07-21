import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addFollowUpAction,
  addMemoryAction,
  completeFollowUpAction,
  deleteContactAction,
  deleteMemoryAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { repoFor } from "@/db/repo";
import { memoryCategory } from "@/db/schema";
import { requireSession } from "@/lib/session";

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ history?: string }>;
}) {
  const { id } = await params;
  const { history } = await searchParams;
  const showHistory = history === "1";
  const { workspace } = await requireSession();
  const contact = await repoFor(workspace.id).getContact(id);
  if (!contact) notFound();

  const currentMemories = contact.memories.filter((m) => m.status === "current");
  const historicalMemories = contact.memories.filter(
    (m) => m.status === "superseded" || m.status === "historical",
  );
  const byCategory = new Map<string, typeof currentMemories>();
  for (const m of currentMemories) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }
  const openFollowUps = contact.followUps.filter((f) => f.status === "open");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {contact.preferredName ?? contact.firstName} {contact.lastName ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[contact.currentRole, contact.currentCompany].filter(Boolean).join(" @ ")}
            {contact.location ? ` · ${contact.location}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {contact.tags.map((t) => (
              <Badge key={t.id} variant="secondary">{t.name}</Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {contact.linkedinUrl && (
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={
                <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" />
              }
            >
              LinkedIn
            </Button>
          )}
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href={`/contacts/${contact.id}/edit`} />}
          >
            Edit
          </Button>
          <form action={deleteContactAction.bind(null, contact.id)}>
            <Button variant="destructive" size="sm" type="submit">
              Delete
            </Button>
          </form>
        </div>
      </div>

      {/* AI snapshot placeholder (Phase 3) */}
      <Card className="border-dashed">
        <CardContent className="py-4 text-sm text-muted-foreground">
          AI snapshot will appear here once the intelligence layer is connected.
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Memories */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Memories</CardTitle>
              {historicalMemories.length > 0 && (
                <Link
                  href={
                    showHistory
                      ? `/contacts/${contact.id}`
                      : `/contacts/${contact.id}?history=1`
                  }
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {showHistory
                    ? "Hide history"
                    : `Show history (${historicalMemories.length})`}
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showHistory && historicalMemories.length > 0 && (
              <div className="rounded border border-dashed p-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  History
                </h3>
                <ul className="space-y-1">
                  {historicalMemories.map((m) => {
                    const replacement = m.supersededByMemoryId
                      ? contact.memories.find(
                          (x) => x.id === m.supersededByMemoryId,
                        )
                      : null;
                    return (
                      <li key={m.id} className="text-sm text-muted-foreground">
                        <span className="line-through">{m.text}</span>
                        <span className="ml-1 text-xs">({m.status})</span>
                        {replacement && (
                          <span className="block text-xs">
                            → now: {replacement.text}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {byCategory.size === 0 && (
              <p className="text-sm text-muted-foreground">No memories yet.</p>
            )}
            {[...byCategory.entries()].map(([category, mems]) => (
              <div key={category}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </h3>
                <ul className="space-y-1">
                  {mems.map((m) => (
                    <li key={m.id} className="group flex items-start justify-between gap-2 text-sm">
                      <span>
                        {m.text}
                        {m.eventDate && (
                          <span className="text-muted-foreground"> ({m.eventDate}{m.eventDatePrecision !== "exact" ? ` · ${m.eventDatePrecision}` : ""})</span>
                        )}
                      </span>
                      <form action={deleteMemoryAction.bind(null, contact.id, m.id)}>
                        <button className="text-muted-foreground/50 hover:text-destructive" title="Delete memory">
                          ×
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <form action={addMemoryAction.bind(null, contact.id)} className="space-y-2 border-t pt-3">
              <Textarea name="text" placeholder="Add a memory…" required rows={2} />
              <div className="flex gap-2">
                <select name="category" className="rounded border px-2 py-1 text-sm">
                  {memoryCategory.enumValues.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input type="date" name="eventDate" className="rounded border px-2 py-1 text-sm" title="Event date (when the thing happens)" />
                <Button type="submit" size="sm">Add</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Follow-ups */}
        <Card>
          <CardHeader>
            <CardTitle>Open follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openFollowUps.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing open.</p>
            )}
            {openFollowUps.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <p>{f.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.reason}
                    {f.dueDate ? ` · due ${f.dueDate}` : ""} · {f.priority}
                  </p>
                </div>
                <form action={completeFollowUpAction.bind(null, contact.id, f.id)}>
                  <Button variant="outline" size="sm" type="submit">Done</Button>
                </form>
              </div>
            ))}
            <form action={addFollowUpAction.bind(null, contact.id)} className="space-y-2 border-t pt-3">
              <Input name="description" placeholder="Follow up on…" required />
              <Input name="reason" placeholder="Why?" />
              <div className="flex gap-2">
                <input type="date" name="dueDate" className="rounded border px-2 py-1 text-sm" />
                <select name="priority" className="rounded border px-2 py-1 text-sm" defaultValue="medium">
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
                <Button type="submit" size="sm">Add</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Interactions</CardTitle>
            <Button
              nativeButton={false}
              size="sm"
              variant="outline"
              render={<Link href={`/interactions/new?contactId=${contact.id}`} />}
            >
              Log interaction
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {contact.interactions.length === 0 && (
            <p className="text-sm text-muted-foreground">No interactions yet.</p>
          )}
          {contact.interactions.map((i) => (
            <details key={i.id} className="rounded border p-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{i.type}</span>
                {" · "}
                {new Date(i.occurredAt).toLocaleDateString()}
                {i.location ? ` · ${i.location}` : ""}
                <Link href={`/interactions/${i.id}`} className="ml-2 text-xs text-muted-foreground hover:underline">
                  open
                </Link>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {i.rawSource}
              </pre>
            </details>
          ))}
        </CardContent>
      </Card>

      {contact.howWeMet && (
        <Card>
          <CardHeader><CardTitle>How we met</CardTitle></CardHeader>
          <CardContent className="text-sm">{contact.howWeMet}</CardContent>
        </Card>
      )}
      {contact.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{contact.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}
