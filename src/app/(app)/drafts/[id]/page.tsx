import Link from "next/link";
import { notFound } from "next/navigation";
import { discardDraftAction, regenerateDraftAction } from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { DoneDialog } from "@/components/done-dialog";
import { DraftEditor } from "@/components/draft-editor";
import { CopyPromptButton, DraftPoller } from "@/components/draft-pending";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { repoFor } from "@/db/repo";
import { CHANNEL_SPECS, renderDraftPrompt } from "@/lib/drafting";
import { requireSession } from "@/lib/session";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const row = await repo.getDraft(id);
  if (!row) notFound();

  const { draft, contact, followUp } = row;
  const spec = CHANNEL_SPECS[draft.channel];
  const contactName =
    `${contact.preferredName ?? contact.firstName} ${contact.lastName ?? ""}`.trim();
  const channelName =
    draft.channel === "other" && draft.channelLabel
      ? draft.channelLabel
      : spec.label;

  const closed =
    draft.status === "sent" ||
    draft.status === "sent_other" ||
    draft.status === "discarded";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {channelName} to{" "}
            <Link href={`/contacts/${contact.id}`} className="hover:underline">
              {contactName}
            </Link>
          </h1>
          {followUp && (
            <p className="mt-1 text-sm text-muted-foreground">
              {followUp.description}
              <span className="block text-xs">{followUp.reason}</span>
            </p>
          )}
        </div>
        {closed && (
          <Badge variant="secondary">
            {draft.status === "sent"
              ? "sent"
              : draft.status === "sent_other"
                ? "sent another way"
                : "discarded"}
          </Badge>
        )}
      </div>

      {draft.status === "requested" && (
        <PendingCard draftId={draft.id} repo={repo} />
      )}

      {draft.status === "drafted" && (
        <Card>
          <CardHeader>
            <CardTitle>Your draft</CardTitle>
            <CardDescription>
              Edit it freely — it saves as you type. Nothing is sent from here;
              you send it yourself, then come back and hit Done.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <DraftEditor
              draftId={draft.id}
              channel={draft.channel}
              initialBody={draft.body ?? ""}
              initialSubject={draft.subject ?? ""}
              aiBody={draft.aiBody ?? ""}
              phone={contact.phone}
              email={contact.emails[0] ?? null}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <form
                action={regenerateDraftAction.bind(null, draft.id)}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  name="instruction"
                  placeholder="shorter, warmer, drop the apology…"
                  className="h-8 w-56 text-sm"
                />
                {/* Always confirms: silently discarding a rewrite is the
                    worst bug this feature could ship with. */}
                <ConfirmButton
                  variant="outline"
                  size="sm"
                  message="Regenerating replaces the current message text. Continue?"
                >
                  Regenerate
                </ConfirmButton>
              </form>

              <div className="flex items-center gap-2">
                <form action={discardDraftAction.bind(null, draft.id)}>
                  <Button variant="ghost" size="sm" type="submit">
                    Discard
                  </Button>
                </form>
                <DoneDialog
                  followUpId={followUp?.id ?? null}
                  contactId={contact.id}
                  draftId={draft.id}
                  hasBody
                  returnTo={`/contacts/${contact.id}`}
                  triggerVariant="default"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {closed && (
        <Card>
          <CardHeader>
            <CardTitle>
              {draft.status === "sent"
                ? "Sent as written"
                : draft.status === "sent_other"
                  ? "You reached out another way"
                  : "Discarded"}
            </CardTitle>
            <CardDescription>
              {draft.status === "sent"
                ? "Logged to their history word for word."
                : draft.status === "sent_other"
                  ? "This draft's text was never sent, so nothing was logged from it."
                  : "Nothing was sent and nothing was logged."}
            </CardDescription>
          </CardHeader>
          {draft.body && (
            <CardContent>
              <p className="whitespace-pre-wrap rounded border bg-muted/40 p-3 text-sm">
                {draft.body}
              </p>
            </CardContent>
          )}
        </Card>
      )}

      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={`/contacts/${contact.id}`} />}
      >
        Back to {contactName}
      </Button>
    </div>
  );
}

/** Waiting on the connected Claude to fill this in. */
async function PendingCard({
  draftId,
  repo,
}: {
  draftId: string;
  repo: ReturnType<typeof repoFor>;
}) {
  const ctx = await repo.buildDraftContext(draftId);
  const prompt = ctx ? renderDraftPrompt(ctx) : "";

  return (
    <Card>
      <DraftPoller />
      <CardHeader>
        <CardTitle>Waiting on your AI</CardTitle>
        <CardDescription>
          Ask Claude to &ldquo;check my pending drafts&rdquo; — it will write
          this one and it&apos;ll appear here. Not in a session right now? Copy
          the prompt and paste it anywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <CopyPromptButton prompt={prompt} />
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Show the context being used
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {prompt}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}
