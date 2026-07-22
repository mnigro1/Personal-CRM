import Link from "next/link";
import { DoneDialog } from "@/components/done-dialog";
import { DraftMessageButton } from "@/components/draft-message-button";
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
 * Home (spec §6): follow-ups due or overdue grouped by contact, the capture
 * queue, and recently added contacts. Deliberately nothing else — this is
 * not the weekly digest or the maintenance engine.
 */
export default async function HomePage() {
  const { user, workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const [followUps, pending, proposed, failed, recent] = await Promise.all([
    repo.listOpenFollowUps(),
    repo.listPendingCaptures(),
    repo.listProposedExtractions(),
    repo.listFailedExtractions(),
    repo.listRecentContacts(5),
  ]);

  // A draft already in flight turns the button into "Open draft" instead of
  // silently starting a second one.
  const activeDrafts = await repo.activeDraftsByFollowUp(
    followUps.map((f) => f.followUp.id),
  );

  // Compare on the user's local calendar day, not UTC.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
  }).format(new Date());
  const inAWeek = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone })
    .format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  const dated = followUps.filter((f) => f.followUp.dueDate);
  const overdue = dated.filter((f) => f.followUp.dueDate! < todayStr);
  const dueSoon = dated.filter(
    (f) => f.followUp.dueDate! >= todayStr && f.followUp.dueDate! <= inAWeek,
  );
  const later = dated.filter((f) => f.followUp.dueDate! > inAWeek);
  const undated = followUps.filter((f) => !f.followUp.dueDate);

  type Row = (typeof followUps)[number];
  const groupByContact = (rows: Row[]) => {
    const map = new Map<string, { name: string; rows: Row[] }>();
    for (const r of rows) {
      const name = `${r.contact.firstName} ${r.contact.lastName ?? ""}`.trim();
      const entry = map.get(r.contact.id) ?? { name, rows: [] };
      entry.rows.push(r);
      map.set(r.contact.id, entry);
    }
    return [...map.entries()];
  };

  const FollowUpGroup = ({
    rows,
    tone,
  }: {
    rows: Row[];
    tone?: "overdue";
  }) => (
    <div className="space-y-3">
      {groupByContact(rows).map(([contactId, { name, rows: items }]) => (
        <div key={contactId} className="rounded border p-3">
          <Link
            href={`/contacts/${contactId}`}
            className="text-sm font-medium hover:underline"
          >
            {name}
          </Link>
          <ul className="mt-1 space-y-2">
            {items.map(({ followUp: f, contact }) => (
              <li key={f.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{f.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.reason}
                  </p>
                  <p className="mt-0.5 text-xs">
                    <span
                      className={
                        tone === "overdue"
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      due {f.dueDate}
                    </span>
                    {f.priority === "high" && (
                      <Badge variant="secondary" className="ml-2">high</Badge>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <DraftMessageButton
                    contactId={contact.id}
                    followUpId={f.id}
                    contactName={
                      contact.preferredName ?? contact.firstName
                    }
                    hasPhone={!!contact.phone}
                    hasEmail={contact.emails.length > 0}
                    existingDraftId={activeDrafts.get(f.id)?.id}
                    existingDraftWritten={
                      activeDrafts.get(f.id)?.status === "drafted"
                    }
                  />
                  <DoneDialog
                    followUpId={f.id}
                    contactId={contact.id}
                    draftId={activeDrafts.get(f.id)?.id ?? null}
                    hasBody={!!activeDrafts.get(f.id)?.body}
                    returnTo="/"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  const queueCount = pending.length + proposed.length + failed.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Home</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/interactions/new" />}
          >
            Log interaction
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/contacts/new" />}
          >
            Add contact
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Follow-ups
            {overdue.length > 0 && (
              <Badge variant="destructive">{overdue.length} overdue</Badge>
            )}
          </CardTitle>
          <CardDescription>
            The follow-through half of the job — everything you said you&apos;d do.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {followUps.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing open. Log an interaction and your AI will propose
              follow-ups worth keeping.
            </p>
          )}

          {overdue.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
                Overdue
              </h3>
              <FollowUpGroup rows={overdue} tone="overdue" />
            </section>
          )}

          {dueSoon.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Next 7 days
              </h3>
              <FollowUpGroup rows={dueSoon} />
            </section>
          )}

          {(later.length > 0 || undated.length > 0) && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Later ({later.length + undated.length})
              </summary>
              <div className="mt-2 space-y-3">
                {later.length > 0 && <FollowUpGroup rows={later} />}
                {undated.length > 0 && <FollowUpGroup rows={undated} />}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {queueCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Capture queue
              <Badge variant="secondary">{queueCount}</Badge>
            </CardTitle>
            <CardDescription>
              {proposed.length > 0
                ? "Proposals are waiting for your review."
                : "Captured and safe — your AI turns these into memories next time you chat."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {proposed.length > 0 && (
              <p>
                <strong>{proposed.length}</strong> proposal
                {proposed.length === 1 ? "" : "s"} to review
              </p>
            )}
            {pending.length > 0 && (
              <p>
                <strong>{pending.length}</strong> capture
                {pending.length === 1 ? "" : "s"} awaiting extraction
              </p>
            )}
            {failed.length > 0 && (
              <p className="text-destructive">
                <strong>{failed.length}</strong> failed extraction
                {failed.length === 1 ? "" : "s"} — the notes are safe
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/review" />}
            >
              Open review
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recently added</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/contacts/${c.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {c.preferredName ?? c.firstName} {c.lastName ?? ""}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    {[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
