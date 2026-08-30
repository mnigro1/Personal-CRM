import Link from "next/link";
import { IntroActions } from "@/components/intro-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TERMINAL_INTRO_STATUSES } from "@/db/repo-intros";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  opt_in_pending: "Awaiting opt-in",
  opt_in_confirmed: "Both opted in",
  sent: "Sent — awaiting outcome",
  completed: "Completed",
  declined: "Declined",
  abandoned: "Abandoned",
};

const OUTCOME_LABEL: Record<string, string> = {
  no_response: "No response",
  met_once: "Met once",
  ongoing: "Ongoing relationship",
  opportunity: "Led to an opportunity",
  unknown: "Not sure",
};

function nameOf(c: { firstName: string; lastName: string | null; preferredName: string | null }) {
  return `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim();
}

/**
 * Intros (README "Intros"): the one place two contacts are related to each
 * other. Was backend/MCP-only — this is its first web UI.
 */
export default async function IntrosPage() {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const [rows, stats] = await Promise.all([
    repo.listIntros(),
    repo.getIntroStats(),
  ]);

  const inFlight = rows.filter(
    (r) => !TERMINAL_INTRO_STATUSES.includes(r.intro.status),
  );
  const history = rows.filter((r) =>
    TERMINAL_INTRO_STATUSES.includes(r.intro.status),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Intros</h1>
        <Button size="sm" nativeButton={false} render={<Link href="/intros/new" />}>
          New intro
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>This month</CardTitle>
          <CardDescription>
            Goal: {stats.goalPerMonth} double opt-in intro
            {stats.goalPerMonth === 1 ? "" : "s"}/month.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-2xl font-semibold">
              {stats.currentMonth.sent}/{stats.currentMonth.goal}
            </p>
            <p className="text-xs text-muted-foreground">sent this month</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{stats.rolling.sent}</p>
            <p className="text-xs text-muted-foreground">
              sent in last {stats.rolling.months} months
              {stats.rolling.onPace ? "" : " (behind pace)"}
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold">
              {stats.doubleOptIn.rate === null
                ? "—"
                : `${Math.round(stats.doubleOptIn.rate * 100)}%`}
            </p>
            <p className="text-xs text-muted-foreground">double opt-in rate</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">
              {stats.inFlight.awaitingOptIn + stats.inFlight.sentAwaitingOutcome}
            </p>
            <p className="text-xs text-muted-foreground">
              in flight ({stats.inFlight.awaitingOptIn} awaiting opt-in,{" "}
              {stats.inFlight.sentAwaitingOutcome} awaiting outcome)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In flight</CardTitle>
          <CardDescription>
            Proposed, waiting on an opt-in, or sent and waiting on an outcome.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inFlight.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing in flight. Log an intro when you connect two people.
            </p>
          )}
          {inFlight.map(({ intro, personA, personB }) => (
            <div key={intro.id} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <Link href={`/contacts/${personA.id}`} className="hover:underline">
                      {nameOf(personA)}
                    </Link>
                    {" ↔ "}
                    <Link href={`/contacts/${personB.id}`} className="hover:underline">
                      {nameOf(personB)}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">{intro.reason}</p>
                </div>
                <Badge variant="secondary">{STATUS_LABEL[intro.status]}</Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  {personA.firstName}: {intro.aOptedInAt ? "opted in" : "no opt-in yet"}
                </span>
                <span>
                  {personB.firstName}: {intro.bOptedInAt ? "opted in" : "no opt-in yet"}
                </span>
              </div>
              <IntroActions
                introId={intro.id}
                personA={{ id: personA.id, name: personA.firstName }}
                personB={{ id: personB.id, name: personB.firstName }}
                aOptedIn={!!intro.aOptedInAt}
                bOptedIn={!!intro.bOptedInAt}
                status={intro.status}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Completed, declined, or abandoned.</CardDescription>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {history.length} past intro{history.length === 1 ? "" : "s"}
              </summary>
              <div className="mt-3 space-y-2">
                {history.map(({ intro, personA, personB }) => (
                  <div
                    key={intro.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        <Link href={`/contacts/${personA.id}`} className="hover:underline">
                          {nameOf(personA)}
                        </Link>
                        {" ↔ "}
                        <Link href={`/contacts/${personB.id}`} className="hover:underline">
                          {nameOf(personB)}
                        </Link>
                      </p>
                      <p className="text-xs text-muted-foreground">{intro.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {intro.outcome && (
                        <span className="text-xs text-muted-foreground">
                          {OUTCOME_LABEL[intro.outcome] ?? intro.outcome}
                        </span>
                      )}
                      <Badge
                        variant={intro.status === "completed" ? "secondary" : "outline"}
                      >
                        {STATUS_LABEL[intro.status]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
