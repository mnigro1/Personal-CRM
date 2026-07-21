import Link from "next/link";
import { reRunExtractionAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
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

export default async function ReviewInboxPage() {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const [pending, proposed, failed] = await Promise.all([
    repo.listPendingCaptures(),
    repo.listProposedExtractions(),
    repo.listFailedExtractions(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Proposals to review
            {proposed.length > 0 && <Badge>{proposed.length}</Badge>}
          </CardTitle>
          <CardDescription>
            Claude extracted these — nothing is saved until you approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {proposed.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          )}
          {proposed.map(({ extraction, interaction }) => (
            <div key={extraction.id} className="flex items-center justify-between rounded border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{interaction.rawSource.slice(0, 120)}</p>
                <p className="text-xs text-muted-foreground">
                  {interaction.type} · {new Date(interaction.occurredAt).toLocaleDateString()} · attempt {extraction.attempt} · {extraction.model}
                </p>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/review/${extraction.id}`} />}>
                Review
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Awaiting extraction
            {pending.length > 0 && <Badge variant="secondary">{pending.length}</Badge>}
          </CardTitle>
          <CardDescription>
            Captured and safe. Ask Claude to &quot;process my captures&quot; to
            turn them into memories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground">All caught up.</p>
          )}
          {pending.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded border p-3">
              <p className="min-w-0 truncate text-sm">{i.rawSource.slice(0, 120)}</p>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/interactions/${i.id}`} />}
              >
                Open
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {failed.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>Failed extractions</CardTitle>
            <CardDescription>
              The capture is safe — extraction failure is never capture failure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {failed.map(({ extraction, interaction }) => (
              <div key={extraction.id} className="flex items-center justify-between rounded border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{interaction.rawSource.slice(0, 120)}</p>
                  <p className="text-xs text-destructive">{extraction.error}</p>
                </div>
                <form action={reRunExtractionAction.bind(null, interaction.id)}>
                  <Button variant="outline" size="sm" type="submit">
                    Retry extraction
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
