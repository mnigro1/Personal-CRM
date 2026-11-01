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
import { repoFor, type Repo } from "@/db/repo";
import { connectionStatusFor } from "@/db/tokens";
import { voiceFor } from "@/lib/drafting";
import { requireSession } from "@/lib/session";

type Row = Awaited<ReturnType<Repo["listOpenFollowUps"]>>[number];
type ActiveDrafts = Awaited<ReturnType<Repo["activeDraftsByFollowUp"]>>;

function groupByContact(rows: Row[]) {
  const map = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    const name = `${r.contact.firstName} ${r.contact.lastName ?? ""}`.trim();
    const entry = map.get(r.contact.id) ?? { name, rows: [] };
    entry.rows.push(r);
    map.set(r.contact.id, entry);
  }
  return [...map.entries()];
}

/**
 * Home (spec §6): follow-ups due or overdue grouped by contact, the capture
 * queue, and recently added contacts. Deliberately nothing else — this is
 * not the weekly digest or the maintenance engine.
 */
export default async function HomePage() {
  const { user, workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const [followUps, pending, proposed, failed, recent, anyInteraction, connection] =
    await Promise.all([
      repo.listOpenFollowUps(),
      repo.listPendingCaptures(),
      repo.listProposedExtractions(),
      repo.listFailedExtractions(),
      repo.listRecentContacts(5),
      repo.listInteractions(1),
      connectionStatusFor(user.id),
    ]);

  // First-run checklist: shown until the three things that make the product
  // work have each happened once. Writing a voice is a nudge, not a gate.
  const setup = {
    connected: connection.lastUsedAt !== null,
    hasToken: connection.hasToken,
    hasContact: recent.length > 0,
    hasInteraction: anyInteraction.length > 0,
    hasVoice: !!voiceFor(user).voice,
  };
  const showChecklist = !(setup.connected && setup.hasContact && setup.hasInteraction);

  // A draft already in flight turns the button into "Open draft" instead of
  // silently starting a second one.
  const activeDrafts = await repo.activeDraftsByFollowUp(
    followUps.map((f) => f.followUp.id),
  );

  // Compare on the user's local calendar day, not UTC.
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
  }).format(now);
  const inAWeek = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone })
    .format(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  const dated = followUps.filter((f) => f.followUp.dueDate);
  const overdue = dated.filter((f) => f.followUp.dueDate! < todayStr);
  const dueSoon = dated.filter(
    (f) => f.followUp.dueDate! >= todayStr && f.followUp.dueDate! <= inAWeek,
  );
  const later = dated.filter((f) => f.followUp.dueDate! > inAWeek);
  const undated = followUps.filter((f) => !f.followUp.dueDate);

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

      {showChecklist && <FirstRunChecklist {...setup} />}

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
              <FollowUpGroup rows={overdue} drafts={activeDrafts} tone="overdue" />
            </section>
          )}

          {dueSoon.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Next 7 days
              </h3>
              <FollowUpGroup rows={dueSoon} drafts={activeDrafts} />
            </section>
          )}

          {(later.length > 0 || undated.length > 0) && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Later ({later.length + undated.length})
              </summary>
              <div className="mt-2 space-y-3">
                {later.length > 0 && <FollowUpGroup rows={later} drafts={activeDrafts} />}
                {undated.length > 0 && <FollowUpGroup rows={undated} drafts={activeDrafts} />}
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

/**
 * The three things a new account needs before Home has anything to show,
 * in the order that makes the rest easy: connect the AI first and the other
 * two happen by talking to it. Each unfinished step is a link to where it
 * gets done.
 */
function FirstRunChecklist({
  connected,
  hasToken,
  hasContact,
  hasInteraction,
  hasVoice,
}: {
  connected: boolean;
  hasToken: boolean;
  hasContact: boolean;
  hasInteraction: boolean;
  hasVoice: boolean;
}) {
  const steps: { done: boolean; title: string; detail: string; href: string; cta: string }[] = [
    {
      done: connected,
      title: "Connect your AI",
      detail: hasToken
        ? "Your connector URL exists — finish adding it to Claude or ChatGPT and ask it something."
        : "Five minutes, once. Then you can just tell Claude or ChatGPT about the people you meet.",
      href: "/connect",
      cta: hasToken ? "Finish connecting" : "Connect",
    },
    {
      done: hasContact,
      title: "Add your first contact",
      detail: "Or let your AI do it: “add Sam Rivera, product lead at Northwind, met at the HBS mixer”.",
      href: "/contacts/new",
      cta: "Add a contact",
    },
    {
      done: hasInteraction,
      title: "Log your first interaction",
      detail: "Paste notes or a message, or tell your AI what happened. Memories and follow-ups come out the other side.",
      href: "/interactions/new",
      cta: "Log one",
    },
    {
      done: hasVoice,
      title: "Describe how you write (optional)",
      detail: "Drafts your AI writes for you will sound like you instead of a template.",
      href: "/settings",
      cta: "Set your voice",
    },
  ];
  const remaining = steps.filter((s) => !s.done && s.title !== steps[3].title).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Let&apos;s get you set up</CardTitle>
        <CardDescription>
          {remaining === 1
            ? "One step to go and the app starts working for you."
            : `${remaining} short steps and the app starts working for you.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                    s.done
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-muted-foreground/40 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>
                    {s.title}
                  </p>
                  {!s.done && (
                    <p className="text-xs text-muted-foreground">{s.detail}</p>
                  )}
                </div>
              </div>
              {!s.done && (
                <Button
                  size="sm"
                  variant={s.title === "Connect your AI" ? "default" : "outline"}
                  nativeButton={false}
                  render={<Link href={s.href} />}
                  className="shrink-0"
                >
                  {s.cta}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Open follow-ups for one bucket (overdue / this week / later), grouped by person. */
function FollowUpGroup({
  rows,
  drafts,
  tone,
}: {
  rows: Row[];
  drafts: ActiveDrafts;
  tone?: "overdue";
}) {
  return (
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
                    existingDraftId={drafts.get(f.id)?.id}
                    existingDraftWritten={
                      drafts.get(f.id)?.status === "drafted"
                    }
                  />
                  <DoneDialog
                    followUpId={f.id}
                    contactId={contact.id}
                    draftId={drafts.get(f.id)?.id ?? null}
                    hasBody={!!drafts.get(f.id)?.body}
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
}
