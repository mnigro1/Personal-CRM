import Link from "next/link";
import { MergeDialog, type MergeSide } from "@/components/merge-dialog";
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

/**
 * The cleanup surface for duplicates that already exist. Scanning is cheap
 * and read-only; merging is always an explicit per-pair decision — this page
 * never consolidates anything on its own.
 */
export default async function DuplicatesPage() {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const pairs = await repo.findDuplicateContactPairs();

  // Counts make the merge direction an informed choice rather than a guess.
  const sides = new Map<string, MergeSide>();
  await Promise.all(
    [...new Set(pairs.flatMap((p) => [p.aId, p.bId]))].map(async (id) => {
      const c = await repo.getContact(id);
      if (!c) return;
      sides.set(id, {
        id: c.id,
        name: `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim(),
        detail: [c.currentRole, c.currentCompany, c.location]
          .filter(Boolean)
          .join(" · "),
        memories: c.memories.filter((m) => m.status === "current").length,
        interactions: c.interactions.length,
        followUps: c.followUps.filter((f) => f.status === "open").length,
      });
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Possible duplicates</h1>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/contacts" />}
        >
          All contacts
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Same person, two records?
            {pairs.length > 0 && (
              <Badge variant="secondary">{pairs.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Matched on name similarity, so some of these will be different
            people who happen to share a name. Nothing merges until you say so.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pairs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No duplicates found. New contacts are checked as they&apos;re
              added, from both the form and your AI.
            </p>
          )}

          {pairs.map((p) => {
            const a = sides.get(p.aId);
            const b = sides.get(p.bId);
            if (!a || !b) return null;
            return (
              <div
                key={`${p.aId}-${p.bId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/contacts/${a.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">and</span>
                    <Link
                      href={`/contacts/${b.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {b.name}
                    </Link>
                    <Badge variant="secondary">
                      {Math.round(Number(p.similarity) * 100)}% name match
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.detail || "no details"} — {b.detail || "no details"}
                  </p>
                </div>
                <MergeDialog a={a} b={b} />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
