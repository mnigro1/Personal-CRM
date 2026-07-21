import Link from "next/link";
import { deleteInteractionAction } from "@/app/actions";
import { repoFor } from "@/db/repo";
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
  const { workspace } = await requireSession();
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
            <TableHead>Type</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Source</TableHead>
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
              <TableCell>{new Date(i.occurredAt).toLocaleString()}</TableCell>
              <TableCell>{i.type}</TableCell>
              <TableCell>{i.location}</TableCell>
              <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                {i.rawSource}
              </TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
