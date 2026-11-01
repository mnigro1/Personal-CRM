import Link from "next/link";
import { deleteInteractionAction } from "@/app/actions";
import { repoFor } from "@/db/repo";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ClickableRow } from "@/components/clickable-row";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function InteractionsPage() {
  const { user, workspace } = await requireSession();
  const rows = await repoFor(workspace.id).listInteractions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interactions</h1>
        <Button nativeButton={false} render={<Link href="/interactions/new" />}>
          Log interaction
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No interactions yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((i) => (
            <ClickableRow
              key={i.id}
              href={`/interactions/${i.id}`}
              editHref={`/interactions/${i.id}`}
              deleteAction={deleteInteractionAction.bind(null, i.id)}
              deleteMessage="Delete this interaction? Its raw notes will be permanently removed."
            >
              <TableCell className="whitespace-nowrap">
                {formatDateTime(i.occurredAt, user.timezone)}
                <span className="block text-xs text-muted-foreground capitalize sm:hidden">
                  {i.type}
                </span>
              </TableCell>
              <TableCell className="hidden capitalize sm:table-cell">{i.type}</TableCell>
              <TableCell className="hidden md:table-cell">{i.location}</TableCell>
              <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground sm:max-w-md">
                {i.rawSource}
              </TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
