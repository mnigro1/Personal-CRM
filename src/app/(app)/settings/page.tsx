import { headers } from "next/headers";
import {
  createInviteAction,
  createMcpTokenAction,
  revokeMcpTokenAction,
  updateTimezoneAction,
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
import { repoFor } from "@/db/repo";
import { listMcpTokens } from "@/db/tokens";
import { requireSession } from "@/lib/session";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ newToken?: string }>;
}) {
  const { newToken } = await searchParams;
  const { user, workspace } = await requireSession();
  const inviteRows = await repoFor(workspace.id).listInvites(user.id);
  const tokens = await listMcpTokens(user.id);
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
                Your connector URL — copy it now, it won&apos;t be shown again:
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
                      Created {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt
                        ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
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
                      Accepted {new Date(inv.acceptedAt).toLocaleDateString()}
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
    </div>
  );
}
