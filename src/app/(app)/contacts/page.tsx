import Link from "next/link";
import { deleteContactAction } from "@/app/actions";
import { ClickableRow } from "@/components/clickable-row";
import { repoFor, type ContactFilters } from "@/db/repo";
import {
  nextSortState,
  parseSortState,
  sortContacts,
  type SortDir,
  type SortKey,
} from "@/lib/contact-sort";
import { formatDate } from "@/lib/dates";
import { safeHttpUrl } from "@/lib/normalize";
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

/** A column header that cycles the sort on click; the arrow shows the state. */
function SortHead({
  active,
  dir,
  href,
  className,
  children,
}: {
  active: boolean;
  dir: SortDir | undefined;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const arrow = !active ? "↕" : dir === "asc" ? "↑" : "↓";
  return (
    <TableHead
      className={className}
      aria-sort={!active ? "none" : dir === "asc" ? "ascending" : "descending"}
    >
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {children}
        <span
          aria-hidden
          className={`text-xs ${active ? "" : "text-muted-foreground/50"}`}
        >
          {arrow}
        </span>
      </Link>
    </TableHead>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { user, workspace } = await requireSession();
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

  const unsorted = await repo.listContacts(filters);
  const openFollowUps = await repo.listOpenFollowUps();
  const followUpCounts = openFollowUps.reduce((m, f) => {
    m.set(f.contact.id, (m.get(f.contact.id) ?? 0) + 1);
    return m;
  }, new Map<string, number>());

  // Column sort lives in the URL so it survives refresh and composes with
  // the filters above. Click cycle: asc → desc → default order.
  const sortState = parseSortState(asStr(sp.sort), asStr(sp.dir));
  const rows = sortContacts(unsorted, sortState, (c) => followUpCounts.get(c.id) ?? 0);

  const sortHref = (key: SortKey) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "sort" || k === "dir" || v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) if (item !== "") params.append(k, item);
    }
    const next = nextSortState(sortState, key);
    if (next) {
      params.set("sort", next.key);
      params.set("dir", next.dir);
    }
    const qs = params.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  };

  const head = (key: SortKey, label: string, className?: string) => (
    <SortHead
      active={sortState?.key === key}
      dir={sortState?.dir}
      href={sortHref(key)}
      className={className}
    >
      {label}
    </SortHead>
  );

  // Filters count toward "Clear"; sort state has its own reset (third click).
  const hasFilters = Object.entries(sp).some(
    ([k, v]) => k !== "sort" && k !== "dir" && v !== undefined && v !== "",
  );
  // Anything beyond the search box lives behind "More filters"; keep that
  // open when one of them is in use so the active filter stays visible.
  const hasAdvanced = ["location", "company", "category", "lastBefore", "lastAfter", "openFollowUps"].some(
    (k) => asStr(sp[k]) !== undefined,
  );
  const roleCompany = (c: (typeof rows)[number]) =>
    [c.currentRole, c.currentCompany].filter(Boolean).join(" @ ");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/contacts/duplicates" />}
          >
            Find duplicates
          </Button>
          <Button nativeButton={false} render={<Link href="/contacts/new" />}>Add contact</Button>
        </div>
      </div>

      <form className="space-y-3 rounded-lg border p-3 sm:p-4">
        <div className="flex gap-2">
          <Input
            type="search"
            name="q"
            placeholder="Search name, notes, memories…"
            defaultValue={asStr(sp.q) ?? ""}
            className="min-w-0 flex-1"
          />
          <div className="flex shrink-0 gap-2">
            <Button type="submit">Search</Button>
            {hasFilters && (
              <Button nativeButton={false} variant="ghost" render={<Link href="/contacts" />}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <details open={hasAdvanced}>
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
            More filters
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Input name="location" placeholder="Location" defaultValue={asStr(sp.location) ?? ""} />
            <Input name="company" placeholder="Company" defaultValue={asStr(sp.company) ?? ""} />
            <Input name="category" placeholder="Relationship category" defaultValue={asStr(sp.category) ?? ""} />
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Last interaction before</span>
              <Input type="date" name="lastBefore" defaultValue={asStr(sp.lastBefore) ?? ""} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Last interaction after</span>
              <Input type="date" name="lastAfter" defaultValue={asStr(sp.lastAfter) ?? ""} />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
              <input type="checkbox" name="openFollowUps" value="1" defaultChecked={sp.openFollowUps === "1"} />
              Has open follow-ups
            </label>
          </div>
        </details>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            {head("name", "Name")}
            {head("company", "Company / Role", "hidden sm:table-cell")}
            {head("last", "Last interaction", "hidden sm:table-cell")}
            {head("followups", "Follow-ups", "hidden sm:table-cell")}
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
                  {safeHttpUrl(c.linkedinUrl) && (
                    <a
                      href={safeHttpUrl(c.linkedinUrl)!}
                      target="_blank"
                      rel="noreferrer"
                      title="LinkedIn profile"
                      className="text-xs font-normal text-muted-foreground hover:text-foreground"
                    >
                      ↗
                    </a>
                  )}
                </span>
                {/* Phones get one column: the rest of the row folds under the name. */}
                <div className="mt-0.5 flex max-w-[calc(100vw-4rem)] flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal text-muted-foreground sm:hidden">
                  {roleCompany(c) && (
                    <span className="min-w-0 max-w-full truncate">{roleCompany(c)}</span>
                  )}
                  {c.lastInteractionDate && (
                    <span className="whitespace-nowrap">
                      Last {formatDate(c.lastInteractionDate, user.timezone)}
                    </span>
                  )}
                  {followUpCounts.get(c.id) ? (
                    <Badge variant="secondary">{followUpCounts.get(c.id)} open</Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {roleCompany(c)}
                {c.location && (
                  <span className="whitespace-nowrap">
                    {(c.currentRole || c.currentCompany) && " · "}
                    {c.location}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {c.lastInteractionDate
                  ? formatDate(c.lastInteractionDate, user.timezone)
                  : "—"}
              </TableCell>
              <TableCell className="hidden text-sm sm:table-cell">
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
