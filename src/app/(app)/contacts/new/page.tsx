import Link from "next/link";
import { createContactAction } from "@/app/actions";
import { ContactForm } from "@/components/contact-form";
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

/**
 * Adding a contact by hand. When the typed name looks like someone already
 * in the CRM, the action bounces back here with `dupes` instead of
 * inserting — the same gate the AI path has always had. Two records for one
 * person is the failure that splits a relationship's history.
 */
export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const str = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : undefined;
  };

  const dupeIds = (str("dupes") ?? "").split(",").filter(Boolean);
  const candidates = dupeIds.length > 0 ? await loadCandidates(dupeIds) : [];

  // Everything already typed, so the warning costs the user nothing.
  const typed = {
    firstName: str("firstName"),
    lastName: str("lastName"),
    preferredName: str("preferredName"),
    emails: str("emails")?.split(",").map((e) => e.trim()).filter(Boolean),
    phone: str("phone"),
    currentCompany: str("currentCompany"),
    currentRole: str("currentRole"),
    location: str("location"),
    linkedinUrl: str("linkedinUrl"),
    website: str("website"),
    howWeMet: str("howWeMet"),
    dateFirstMet: str("dateFirstMet"),
    relationshipCategory: str("relationshipCategory"),
    notes: str("notes"),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add contact</h1>

      {candidates.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>
              You may already know{" "}
              {[typed.firstName, typed.lastName].filter(Boolean).join(" ")}
            </CardTitle>
            <CardDescription>
              Open the existing record and add to it instead — a second entry
              splits their history in two.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded border p-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.currentRole, c.currentCompany, c.location]
                      .filter(Boolean)
                      .join(" · ") || "No details recorded"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/contacts/${c.id}`} />}
                >
                  Open
                </Button>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Not the same person? Everything you typed is still filled in
              below — submitting again creates a separate contact.
            </p>
          </CardContent>
        </Card>
      )}

      <ContactForm
        action={createContactAction}
        contact={typed as never}
        submitLabel={
          candidates.length > 0
            ? "This is someone new — create anyway"
            : "Create contact"
        }
        hiddenFields={candidates.length > 0 ? { confirmedNew: "1" } : undefined}
      />
    </div>
  );
}

async function loadCandidates(ids: string[]) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const rows = await Promise.all(ids.map((id) => repo.getContact(id)));
  return rows.filter((c) => c !== null).map((c) => ({
    id: c.id,
    name: `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim(),
    currentRole: c.currentRole,
    currentCompany: c.currentCompany,
    location: c.location,
  }));
}
