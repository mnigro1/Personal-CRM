import { createInteractionAction } from "@/app/actions";
import { repoFor } from "@/db/repo";
import { interactionType, sourceType } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function NewInteractionPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { contactId } = await searchParams;
  const { workspace } = await requireSession();
  const contactRows = await repoFor(workspace.id).listContacts();

  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Log interaction</h1>
      <form action={createInteractionAction} className="max-w-2xl space-y-4">
        <div className="space-y-1">
          <Label htmlFor="rawSource">What happened? *</Label>
          <Textarea
            id="rawSource"
            name="rawSource"
            required
            rows={8}
            placeholder="Paste notes, a transcript, or write what you remember. This is stored verbatim and never modified."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="type">Type</Label>
            <select id="type" name="type" className="w-full rounded border px-2 py-2 text-sm" defaultValue="meeting">
              {interactionType.enumValues.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sourceType">Source</Label>
            <select id="sourceType" name="sourceType" className="w-full rounded border px-2 py-2 text-sm" defaultValue="manual_note">
              {sourceType.enumValues.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="occurredAt">When</Label>
            <Input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={local} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="location">Where</Label>
            <Input id="location" name="location" placeholder="Location" />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Who was there?</Label>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border p-3">
            {contactRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No contacts yet — you can still save; link people later by editing.
              </p>
            )}
            {contactRows.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="contactIds"
                  value={c.id}
                  defaultChecked={c.id === contactId}
                />
                {c.preferredName ?? c.firstName} {c.lastName ?? ""}
              </label>
            ))}
          </div>
        </div>
        <Button type="submit">Save interaction</Button>
      </form>
    </div>
  );
}
