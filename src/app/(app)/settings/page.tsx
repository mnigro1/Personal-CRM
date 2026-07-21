import { headers } from "next/headers";
import { createInviteAction, updateTimezoneAction } from "@/app/actions";
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
import { requireSession } from "@/lib/session";

export default async function SettingsPage() {
  const { user, workspace } = await requireSession();
  const inviteRows = await repoFor(workspace.id).listInvites(user.id);
  const h = await headers();
  const origin =
    process.env.APP_URL ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

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
          <form action={updateTimezoneAction} className="flex items-end gap-3">
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
          <form action={createInviteAction} className="flex items-end gap-3">
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
