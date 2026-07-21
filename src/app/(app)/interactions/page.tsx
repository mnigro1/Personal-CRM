import Link from "next/link";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
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
            <TableRow key={i.id}>
              <TableCell>
                <Link href={`/interactions/${i.id}`} className="hover:underline">
                  {new Date(i.occurredAt).toLocaleString()}
                </Link>
              </TableCell>
              <TableCell>{i.type}</TableCell>
              <TableCell>{i.location}</TableCell>
              <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                {i.rawSource}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
