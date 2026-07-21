import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteInteractionAction,
  reRunExtractionAction,
  undoBatchAction,
  updateInteractionAction,
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
import { Label } from "@/components/ui/label";
import { repoFor } from "@/db/repo";
import { interactionType } from "@/db/schema";
import { requireSession } from "@/lib/session";

export default async function InteractionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    duplicate?: string;
    applied?: string;
    undone?: string;
    skipped?: string;
    rerun?: string;
  }>;
}) {
  const { id } = await params;
  const { duplicate, applied, undone, skipped, rerun } = await searchParams;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const interaction = await repo.getInteraction(id);
  if (!interaction) notFound();
  const allContacts = await repo.listContacts();
  const linkedIds = new Set(interaction.contacts.map((c) => c.id));
  const extractionRuns = await repo.getExtractionsForInteraction(id);
  const proposedRun = extractionRuns.find((e) => e.status === "proposed");

  const occurred = new Date(interaction.occurredAt);
  const local = new Date(occurred.getTime() - occurred.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="space-y-6">
      {duplicate === "1" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          You&apos;ve already saved this — this is the existing interaction.
        </div>
      )}
      {applied && (
        <div className="flex items-center justify-between rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
          <span>Saved. Everything is reversible.</span>
          <form action={undoBatchAction.bind(null, applied, interaction.id)}>
            <Button variant="outline" size="sm" type="submit">Undo</Button>
          </form>
        </div>
      )}
      {undone && (
        <div className="rounded-lg border p-3 text-sm text-muted-foreground">
          {Number(skipped) > 0
            ? `Reverted ${undone} change${Number(undone) === 1 ? "" : "s"} — ${skipped} ${Number(skipped) === 1 ? "was" : "were"} edited since and left as ${Number(skipped) === 1 ? "it is" : "they are"}.`
            : `Reverted ${undone} change${Number(undone) === 1 ? "" : "s"}.`}
        </div>
      )}
      {rerun === "1" && (
        <div className="rounded-lg border p-3 text-sm text-muted-foreground">
          Queued for re-extraction — ask Claude to process pending captures.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {interaction.type} · {occurred.toLocaleString()}
          </h1>
          <Badge
            variant={
              interaction.extractionStatus === "failed"
                ? "destructive"
                : interaction.extractionStatus === "pending"
                  ? "default"
                  : "secondary"
            }
          >
            extraction: {interaction.extractionStatus}
          </Badge>
        </div>
        <div className="flex gap-2">
          {proposedRun && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/review/${proposedRun.id}`} />}
            >
              Review proposal
            </Button>
          )}
          {interaction.extractionStatus !== "pending" && (
            <form action={reRunExtractionAction.bind(null, interaction.id)}>
              <Button variant="outline" size="sm" type="submit">
                Re-run extraction
              </Button>
            </form>
          )}
          <form action={deleteInteractionAction.bind(null, interaction.id)}>
            <Button variant="destructive" size="sm" type="submit">
              Delete
            </Button>
          </form>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw source</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm">{interaction.rawSource}</pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Immutable — the AI never rewrites your words.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateInteractionAction.bind(null, interaction.id)}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="type">Type</Label>
                <select id="type" name="type" className="w-full rounded border px-2 py-2 text-sm" defaultValue={interaction.type}>
                  {interactionType.enumValues.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="occurredAt">When</Label>
                <Input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={local} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="location">Where</Label>
                <Input id="location" name="location" defaultValue={interaction.location ?? ""} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Linked contacts</Label>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border p-3">
                {allContacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="contactIds"
                      value={c.id}
                      defaultChecked={linkedIds.has(c.id)}
                    />
                    <Link href={`/contacts/${c.id}`} className="hover:underline">
                      {c.preferredName ?? c.firstName} {c.lastName ?? ""}
                    </Link>
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" size="sm">Save details</Button>
          </form>
        </CardContent>
      </Card>

      {extractionRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extraction history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {extractionRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded border p-3 text-sm"
              >
                <div>
                  <p>
                    Attempt {run.attempt} · {run.status} · {run.model} · prompt{" "}
                    {run.promptVersion}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                    {run.appliedAt &&
                      ` · applied ${new Date(run.appliedAt).toLocaleString()}`}
                    {run.error && ` · ${run.error}`}
                  </p>
                </div>
                {run.status === "proposed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/review/${run.id}`} />}
                  >
                    Review
                  </Button>
                )}
                {run.status === "applied" && run.batchId && (
                  <form action={undoBatchAction.bind(null, run.batchId, interaction.id)}>
                    <Button size="sm" variant="outline" type="submit">
                      Undo
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
