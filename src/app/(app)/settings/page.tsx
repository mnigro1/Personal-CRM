import { cookies, headers } from "next/headers";
import {
  createInviteAction,
  createMcpTokenAction,
  deleteAccountAction,
  revokeMcpTokenAction,
  updateExtractionSettingsAction,
  updateGoalsAction,
  updateTimezoneAction,
  updateVoiceAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { repoFor } from "@/db/repo";
import { listMcpTokens } from "@/db/tokens";
import { NEW_MCP_TOKEN_COOKIE } from "@/lib/cookies";
import { formatDate, formatDateTime } from "@/lib/dates";
import { voiceFor } from "@/lib/drafting";
import { requireSession } from "@/lib/session";
import { extractionSettingsFor } from "@/lib/user-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    voiceSaved?: string;
    goalsSaved?: string;
    extractionSaved?: string;
  }>;
}) {
  const { voiceSaved, goalsSaved, extractionSaved } = await searchParams;
  const { user, workspace } = await requireSession();
  const inviteRows = await repoFor(workspace.id).listInvites(user.id);
  const tokens = await listMcpTokens(user.id);
  // Set by createMcpTokenAction moments ago; expires on its own.
  const newToken = (await cookies()).get(NEW_MCP_TOKEN_COOKIE)?.value;
  const voice = voiceFor(user);
  const extraction = extractionSettingsFor(user.settingsJson);
  const settings = (user.settingsJson ?? {}) as Record<string, unknown>;
  const goals = (settings.goals ?? {}) as Record<string, unknown>;
  const introsPerMonth =
    typeof goals.introsPerMonth === "number" ? goals.introsPerMonth : 2;
  const h = await headers();
  const origin =
    process.env.APP_URL ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Connect your AI</CardTitle>
          <CardDescription>
            Create a connector URL and paste it into claude.ai (Settings →
            Connectors → Add custom connector) or ChatGPT (Settings → Apps
            &amp; Connectors, developer mode). The URL is scoped to your
            workspace only — treat it like a password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {newToken && (
            <div className="space-y-1 rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
              <p className="font-medium">
                Your connector URL — copy it now. It leaves this page in a
                couple of minutes and can&apos;t be shown again:
              </p>
              <code className="block break-all rounded bg-background p-2 text-xs">
                {origin}/api/mcp/{newToken}
              </code>
            </div>
          )}
          <form action={createMcpTokenAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="label">Name</Label>
              <Input id="label" name="label" placeholder="e.g. My Claude" required className="w-64" />
            </div>
            <Button type="submit" size="sm">Create connector URL</Button>
          </form>
          {tokens.length > 0 && (
            <ul className="space-y-2 text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <p className="font-medium">{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(t.createdAt, user.timezone)}
                      {t.lastUsedAt
                        ? ` · last used ${formatDateTime(t.lastUsedAt, user.timezone)}`
                        : " · never used"}
                    </p>
                  </div>
                  <form action={revokeMcpTokenAction.bind(null, t.id)}>
                    <Button variant="outline" size="sm" type="submit">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI extraction</CardTitle>
          <CardDescription>
            When your AI turns notes into memories and follow-ups, it can
            apply them straight away or stage them for you to review first.
            Either way, new people and ambiguous names always wait for your
            call, and every applied batch can be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {extractionSaved === "1" && (
            <p className="mb-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
              Saved. Your AI picks this up the next time you start a chat.
            </p>
          )}
          <form action={updateExtractionSettingsAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="autoApply">Proposals are</Label>
              <select
                id="autoApply"
                name="autoApply"
                defaultValue={extraction.autoApply ? "yes" : "no"}
                className="rounded border px-2 py-2 text-sm"
              >
                <option value="yes">applied automatically</option>
                <option value="no">held for my review</option>
              </select>
            </div>
            <Button type="submit" size="sm">Save</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            &ldquo;Held for my review&rdquo; is the safer choice if you paste
            in text written by other people — the AI then can&apos;t be talked
            into writing anything down without you seeing it first.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your writing voice</CardTitle>
          <CardDescription>
            Every message draft is written against this. Describe how you
            actually write, in as much detail as you like: how you open, how
            you close, the words you reach for, what you never say. Specific
            beats tidy, and quoting your own habits works better than
            adjectives.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {voiceSaved === "1" && (
            <p className="mb-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
              Voice saved. New drafts will use it.
            </p>
          )}
          <form action={updateVoiceAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="voice">How you write</Label>
              <Textarea
                id="voice"
                name="voice"
                rows={16}
                defaultValue={voice.voice ?? ""}
                placeholder="Short paragraphs. Contractions. I open with Hey for people I know…"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="signOff">Sign-off</Label>
                <Input
                  id="signOff"
                  name="signOff"
                  defaultValue={voice.signOff ?? ""}
                  placeholder="-Matt"
                  className="w-72"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emoji">Emoji</Label>
                <select
                  id="emoji"
                  name="emoji"
                  defaultValue={voice.emoji ?? "never"}
                  className="rounded border px-2 py-2 text-sm"
                >
                  <option value="never">never</option>
                  <option value="sparingly">sparingly</option>
                  <option value="yes">yes</option>
                </select>
              </div>
              <Button type="submit" size="sm">Save voice</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goals</CardTitle>
          <CardDescription>
            How many double opt-in intros you aim to make each month. An intro
            only counts once both people have said yes and it has actually
            gone out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {goalsSaved === "1" && (
            <p className="mb-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
              Goal saved.
            </p>
          )}
          <form action={updateGoalsAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="introsPerMonth">Intros per month</Label>
              <Input
                id="introsPerMonth"
                name="introsPerMonth"
                type="number"
                min={0}
                max={100}
                defaultValue={introsPerMonth}
                className="w-32"
              />
            </div>
            <Button type="submit" size="sm">Save goal</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Every relative date (&quot;next spring&quot;, &quot;moving in
            September&quot;) is resolved against this. IANA name, e.g.
            America/New_York.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateTimezoneAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="timezone">Timezone</Label>
              <Input id="timezone" name="timezone" defaultValue={user.timezone} className="w-64" />
            </div>
            <Button type="submit" size="sm">Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
          <CardDescription>
            Invite someone — they get their own fully isolated workspace.
            Nothing is shared between workspaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={createInviteAction} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required className="w-64" placeholder="sister@example.com" />
            </div>
            <Button type="submit" size="sm">Create invite</Button>
          </form>
          {inviteRows.length > 0 && (
            <ul className="space-y-2 text-sm">
              {inviteRows.map((inv) => (
                <li key={inv.id} className="rounded border p-3">
                  <p className="font-medium">{inv.email}</p>
                  {inv.acceptedAt ? (
                    <p className="text-muted-foreground">
                      Accepted {formatDate(inv.acceptedAt, user.timezone)}
                    </p>
                  ) : new Date(inv.expiresAt) < new Date() ? (
                    <p className="text-muted-foreground">Expired</p>
                  ) : (
                    <p className="break-all text-muted-foreground">
                      {origin}/invite/{inv.token}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            It&apos;s yours. Download a copy any time, or delete your account
            and everything in it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Download my data</p>
            <p className="text-sm text-muted-foreground">
              Everything in your workspace as one file you can keep or take
              elsewhere: contacts (including archived ones), interactions with
              your original notes, memories, follow-ups, intros, message
              drafts, change history and your settings. Or just your contacts,
              as a spreadsheet.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href="/api/export" />}
              >
                Download everything (JSON)
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href="/api/export?format=csv" />}
              >
                Contacts only (CSV)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Up to 3 downloads every 10 minutes.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-destructive/40 p-3">
            <p className="text-sm font-medium">Delete my account</p>
            <p className="text-sm text-muted-foreground">
              This deletes your account and everything in it: every contact,
              interaction, memory, follow-up, intro and draft, plus your
              settings and sign-in. It cannot be undone and we keep no copy.
              Your AI connector stops working the moment you confirm. Download
              your data first if you want to keep it.
            </p>
            <form action={deleteAccountAction} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="deleteConfirm">Type DELETE to confirm</Label>
                <Input
                  id="deleteConfirm"
                  name="confirm"
                  placeholder="DELETE"
                  autoComplete="off"
                  autoCapitalize="characters"
                  required
                  pattern="DELETE"
                  className="w-40"
                />
              </div>
              <Button type="submit" variant="destructive" size="sm">
                Delete my account
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
