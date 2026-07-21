import Link from "next/link";
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

  const allTags = await repo.listTags();
  const selectedTagIds = ([] as string[]).concat(sp.tag ?? []);

  const filters: ContactFilters = {
    q: asStr(sp.q),
    location: asStr(sp.location),
    company: asStr(sp.company),
    relationshipCategory: asStr(sp.category),
    tagIds: selectedTagIds.length ? selectedTagIds : undefined,
    tagMode: asStr(sp.tagMode) === "and" ? "and" : "or",
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
        <label className="flex items-center gap-2 text-sm">
          Last interaction before
          <input type="date" name="lastBefore" defaultValue={asStr(sp.lastBefore) ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          after
          <input type="date" name="lastAfter" defaultValue={asStr(sp.lastAfter) ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="openFollowUps" value="1" defaultChecked={sp.openFollowUps === "1"} />
          Has open follow-ups
        </label>
        {allTags.length > 0 && (
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm md:col-span-4">
            <span className="text-muted-foreground">Tags:</span>
            {allTags.map((t) => (
              <label key={t.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="tag"
                  value={t.id}
                  defaultChecked={selectedTagIds.includes(t.id)}
                />
                {t.name}
              </label>
            ))}
            <label className="ml-2 flex items-center gap-1">
              <input type="checkbox" name="tagMode" value="and" defaultChecked={asStr(sp.tagMode) === "and"} />
              match all
            </label>
          </div>
        )}
        <div className="col-span-2 flex gap-2 md:col-span-4">
          <Button type="submit" size="sm">Filter</Button>
          {hasFilters && (
            <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/" />}>
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
            <TableHead>Location</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Last interaction</TableHead>
            <TableHead>LinkedIn</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No contacts yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((c) => (
            <ClickableRow key={c.id} href={`/contacts/${c.id}`}>
              <TableCell className="font-medium">
                {c.preferredName ?? c.firstName} {c.lastName ?? ""}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}
              </TableCell>
              <TableCell className="text-sm">{c.location}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <Badge key={t.id} variant="secondary">{t.name}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.lastInteractionDate
                  ? new Date(c.lastInteractionDate).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                {c.linkedinUrl && (
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground underline hover:text-foreground"
                  >
                    Profile ↗
                  </a>
                )}
              </TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
