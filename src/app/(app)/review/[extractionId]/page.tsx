import Link from "next/link";
import { notFound } from "next/navigation";
import { applyExtractionAction } from "@/app/actions";
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
import { requireSession } from "@/lib/session";
import type { StagedProposal } from "@/lib/proposal";

export default async function ReviewScreen({
  params,
  searchParams,
}: {
  params: Promise<{ extractionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { extractionId } = await params;
  const { error } = await searchParams;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const found = await repo.getExtraction(extractionId);
  if (!found) notFound();
  const { extraction, interaction } = found;

  if (extraction.status !== "proposed") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-muted-foreground">
          This proposal is {extraction.status}.{" "}
          <Link href={`/interactions/${interaction.id}`} className="underline">
            Open the interaction
          </Link>
          .
        </p>
      </div>
    );
  }

  const staged = extraction.proposalJson as StagedProposal;
  const p = staged.proposal;
  const roster = await repo.listContacts();
  const knownMemories = await repo.getMemoriesByIds(
    p.already_known.map((a) => a.existing_memory_id),
  );
  const nameOf = (id: string | null | undefined) => {
    const c = roster.find((r) => r.id === id);
    return c ? `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim() : "?";
  };
  const refLabel = (ref: string) =>
    /^[0-9a-f-]{36}$/i.test(ref) ? nameOf(ref) : `${ref} (new)`;
  const blockingBindings = p.contact_bindings.filter((b) => b.status !== "confident");

  const checkbox = (name: string, defaultChecked: boolean) => (
    <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 shrink-0" />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review proposal</h1>
        <p className="text-sm text-muted-foreground">
          {interaction.type} · {new Date(interaction.occurredAt).toLocaleString()} · attempt {extraction.attempt} · {extraction.model} · prompt {extraction.promptVersion}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {decodeURIComponent(error)}
        </div>
      )}

      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm font-medium">Raw source</summary>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{interaction.rawSource}</pre>
      </details>

      <form action={applyExtractionAction.bind(null, extraction.id)} className="space-y-6">
        {blockingBindings.length > 0 && (
          <Card className="border-amber-400">
            <CardHeader>
              <CardTitle>Needs your call</CardTitle>
              <CardDescription>
                These block saving — a wrong bind writes memories to the wrong person.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {blockingBindings.map((b) => (
                <div key={b.mention} className="space-y-2 rounded border p-3">
                  <p className="text-sm font-medium">
                    &quot;{b.mention}&quot; — {b.status === "ambiguous" ? "did you mean:" : "new contact?"}
                  </p>
                  <div className="space-y-1 text-sm">
                    {b.status === "ambiguous" &&
                      (b.candidates ?? []).map((c) => (
                        <label key={c.contact_id} className="flex items-center gap-2">
                          <input type="radio" name={`bind::${b.mention}`} value={c.contact_id} required />
                          {nameOf(c.contact_id)}
                          {c.hint && <span className="text-muted-foreground">({c.hint})</span>}
                        </label>
                      ))}
                    {b.status === "new" && b.new_contact && (
                      <label className="flex items-center gap-2">
                        <input type="radio" name={`bind::${b.mention}`} value="create" required />
                        Create contact: {b.new_contact.first_name} {b.new_contact.last_name ?? ""}
                        {b.new_contact.current_company && (
                          <span className="text-muted-foreground">@ {b.new_contact.current_company}</span>
                        )}
                      </label>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="radio" name={`bind::${b.mention}`} value="skip" required />
                      Skip — drop everything about {b.mention}
                    </label>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {p.interaction?.summary && (
          <Card>
            <CardHeader><CardTitle>Interaction</CardTitle></CardHeader>
            <CardContent>
              <label className="flex items-start gap-2 text-sm">
                {checkbox("meta", true)}
                <span>
                  Summary: {p.interaction.summary}
                  {p.interaction.location && <> · location: {p.interaction.location}</>}
                  {p.interaction.type && <> · type: {p.interaction.type}</>}
                </span>
              </label>
            </CardContent>
          </Card>
        )}

        {p.new_memories.length > 0 && (
          <Card>
            <CardHeader><CardTitle>New memories</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {p.new_memories.map((m, i) => {
                const flag = staged.flags.new_memories[i];
                return (
                  <div key={i} className="flex items-start gap-2">
                    {checkbox(`nm-${i}`, !flag?.probableDuplicate)}
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        name={`nm-edit-text-${i}`}
                        defaultValue={m.text}
                        className="w-full rounded border px-2 py-1 text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        {refLabel(m.contact)} · {m.category}
                        {m.event_date && <> · {m.event_date} ({m.event_date_precision})</>}
                      </p>
                      {flag?.probableDuplicate && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Probable duplicate of: &quot;{flag.matchText}&quot; ({Math.round(flag.similarity * 100)}% similar) — deselected
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {p.supersessions.length > 0 && (
          <SupersessionSection repo={repo} p={p} checkbox={checkbox} />
        )}

        {p.already_known.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Already knew this</CardTitle>
              <CardDescription>Re-confirmed facts get a freshness bump.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {p.already_known.map((a, i) => {
                const known = knownMemories.find((m) => m.id === a.existing_memory_id);
                return (
                  <label key={i} className="flex items-start gap-2 text-sm">
                    {checkbox(`ak-${i}`, true)}
                    <span className="text-muted-foreground">
                      {known?.text ?? a.existing_memory_id}
                      {a.restated && <span className="block text-xs">restated as: &quot;{a.restated}&quot;</span>}
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        )}

        {p.tags.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Tags</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {p.tags.map((t, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  {checkbox(`tag-${i}`, true)}
                  <Badge variant={t.is_new ? "default" : "secondary"}>
                    {t.name}
                    {t.is_new && " (new)"}
                  </Badge>
                  <span className="text-muted-foreground">→ {refLabel(t.contact)}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        )}

        {p.follow_ups.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Follow-ups</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {p.follow_ups.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  {checkbox(`fu-${i}`, true)}
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      name={`fu-edit-description-${i}`}
                      defaultValue={f.description}
                      className="w-full rounded border px-2 py-1 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {refLabel(f.contact)} · why: {f.reason}
                      {f.due_date && <> · due {f.due_date}</>} · {f.priority}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {p.contact_field_updates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Contact updates</CardTitle>
              <CardDescription>Old values are kept as historical memories, never deleted.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {p.contact_field_updates.map((u, i) => (
                <label key={i} className="flex items-start gap-2 text-sm">
                  {checkbox(`cfu-${i}`, true)}
                  <span>
                    {nameOf(u.contact_id)}: {u.field.replace(/_/g, " ")}{" "}
                    <span className="text-muted-foreground line-through">{u.old_value ?? "—"}</span>{" "}
                    → <strong>{u.new_value}</strong>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg">Save all selected</Button>
          <Button variant="ghost" nativeButton={false} render={<Link href="/review" />}>
            Back to inbox
          </Button>
        </div>
      </form>
    </div>
  );
}

async function SupersessionSection({
  repo,
  p,
  checkbox,
}: {
  repo: ReturnType<typeof repoFor>;
  p: StagedProposal["proposal"];
  checkbox: (name: string, checked: boolean) => React.ReactNode;
}) {
  const rows = await repo.getMemoriesByIds(
    p.supersessions.map((s) => s.existing_memory_id),
  );
  const textOf = (id: string) => rows.find((r) => r.id === id)?.text ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updated facts</CardTitle>
        <CardDescription>
          The old fact is preserved as history — &quot;what were they doing when
          we met?&quot; stays answerable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {p.supersessions.map((s, i) => (
          <label key={i} className="flex items-start gap-2 text-sm">
            {checkbox(`sup-${i}`, true)}
            <span>
              <span className="text-muted-foreground line-through">
                {textOf(s.existing_memory_id)}
              </span>{" "}
              → <strong>{p.new_memories[s.replacement_memory_index]?.text}</strong>
              <span className="block text-xs text-muted-foreground">why: {s.reason}</span>
            </span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}
