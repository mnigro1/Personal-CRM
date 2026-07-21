import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteInteractionAction,
  updateInteractionAction,
} from "@/app/actions";
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
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { id } = await params;
  const { duplicate } = await searchParams;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const interaction = await repo.getInteraction(id);
  if (!interaction) notFound();
  const allContacts = await repo.listContacts();
  const linkedIds = new Set(interaction.contacts.map((c) => c.id));

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

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {interaction.type} · {occurred.toLocaleString()}
        </h1>
        <form action={deleteInteractionAction.bind(null, interaction.id)}>
          <Button variant="destructive" size="sm" type="submit">
            Delete
          </Button>
        </form>
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
    </div>
  );
}
