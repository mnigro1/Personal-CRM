import Link from "next/link";
import { deleteContactAction } from "@/app/actions";
import { ClickableRow } from "@/components/clickable-row";
import { repoFor, type ContactFilters } from "@/db/repo";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function asStr(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);


  const filters: ContactFilters = {
    q: asStr(sp.q),
    location: asStr(sp.location),
    company: asStr(sp.company),
    relationshipCategory: asStr(sp.category),
    lastInteractionBefore: asStr(sp.lastBefore)
      ? new Date(sp.lastBefore as string)
      : undefined,
    lastInteractionAfter: asStr(sp.lastAfter)
      ? new Date(sp.lastAfter as string)
      : undefined,
    dateFirstMetFrom: asStr(sp.metFrom),
    dateFirstMetTo: asStr(sp.metTo),
    hasOpenFollowUps: sp.openFollowUps === "1",
  };

  const rows = await repo.listContacts(filters);
  const openFollowUps = await repo.listOpenFollowUps();
  const followUpCounts = openFollowUps.reduce((m, f) => {
    m.set(f.contact.id, (m.get(f.contact.id) ?? 0) + 1);
    return m;
  }, new Map<string, number>());
  const hasFilters = Object.values(sp).some((v) => v !== undefined && v !== "");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <Button nativeButton={false} render={<Link href="/contacts/new" />}>Add contact</Button>
      </div>

      <form className="grid grid-cols-2 gap-3 rounded-lg border p-4 md:grid-cols-4">
        <Input name="q" placeholder="Search name, notes, memories…" defaultValue={asStr(sp.q) ?? ""} className="col-span-2" />
        <Input name="location" placeholder="Location" defaultValue={asStr(sp.location) ?? ""} />
        <Input name="company" placeholder="Company" defaultValue={asStr(sp.company) ?? ""} />
        <Input name="category" placeholder="Relationship category" defaultValue={asStr(sp.category) ?? ""} />
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Last interaction before
          <input type="date" name="lastBefore" defaultValue={asStr(sp.lastBefore) ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          after
          <input type="date" name="lastAfter" defaultValue={asStr(sp.lastAfter) ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" name="openFollowUps" value="1" defaultChecked={sp.openFollowUps === "1"} />
          Has open follow-ups
        </label>
        <div className="col-span-2 flex gap-2 md:col-span-4">
          <Button type="submit" size="sm">Filter</Button>
          {hasFilters && (
            <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/contacts" />}>
              Clear
            </Button>
          )}
        </div>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company / Role</TableHead>
            <TableHead>Last interaction</TableHead>
            <TableHead>Follow-ups</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No contacts yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((c) => (
            <ClickableRow
              key={c.id}
              href={`/contacts/${c.id}`}
              editHref={`/contacts/${c.id}/edit`}
              deleteAction={deleteContactAction.bind(null, c.id)}
              deleteMessage={`Delete ${c.preferredName ?? c.firstName}? Their memories and interactions are archived, not destroyed.`}
            >
              <TableCell className="font-medium">
                <span className="flex items-center gap-1.5">
                  {c.preferredName ?? c.firstName} {c.lastName ?? ""}
                  {c.linkedinUrl && (
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="LinkedIn profile"
                      className="text-xs font-normal text-muted-foreground hover:text-foreground"
                    >
                      ↗
                    </a>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}
                {c.location && (
                  <span className="whitespace-nowrap">
                    {(c.currentRole || c.currentCompany) && " · "}
                    {c.location}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.lastInteractionDate
                  ? new Date(c.lastInteractionDate).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">
                {followUpCounts.get(c.id) ? (
                  <Badge variant="secondary">
                    {followUpCounts.get(c.id)} open
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
