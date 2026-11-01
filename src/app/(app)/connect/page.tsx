import Link from "next/link";
import { cookies, headers } from "next/headers";
import { createMcpTokenAction } from "@/app/actions";
import { CopyButton } from "@/components/copy-button";
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
import { connectionStatusFor } from "@/db/tokens";
import { NEW_MCP_TOKEN_COOKIE } from "@/lib/cookies";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/session";

/**
 * The guided version of Settings → "Connect your AI", written for someone
 * on a phone who has never heard of a connector. Three steps, one screen,
 * and a live status line so they know when it has worked.
 */
export default async function ConnectPage() {
  const { user } = await requireSession();
  const status = await connectionStatusFor(user.id);
  const newToken = (await cookies()).get(NEW_MCP_TOKEN_COOKIE)?.value;
  const h = await headers();
  const origin =
    process.env.APP_URL ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const connectorUrl = newToken ? `${origin}/api/mcp/${newToken}` : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connect your AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The CRM remembers; your AI does the typing. Connect once and you
          can say &ldquo;had coffee with Sam, she&apos;s moving to Denver in
          March&rdquo; in Claude or ChatGPT and it lands here as a contact, a
          memory and a follow-up.
        </p>
      </div>

      <div
        role="status"
        className={`rounded-lg border p-3 text-sm ${
          status.lastUsedAt
            ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        }`}
      >
        {status.lastUsedAt ? (
          <>
            <span className="font-medium">Connected.</span> Your AI last
            called in {formatDateTime(status.lastUsedAt, user.timezone)}.
          </>
        ) : status.hasToken ? (
          <>
            <span className="font-medium">Almost there.</span> Your connector
            URL exists but your AI hasn&apos;t used it yet — finish steps 2
            and 3 below, then refresh this page.
          </>
        ) : (
          <>
            <span className="font-medium">Not connected yet.</span> Three
            steps, about five minutes.
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Create your connector URL</CardTitle>
          <CardDescription>
            This URL is your AI&apos;s key to your workspace and nobody
            else&apos;s. Treat it like a password: don&apos;t post it or
            forward it. You can revoke it any time in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connectorUrl ? (
            <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
              <p className="font-medium">
                Here it is. Copy it now — it disappears from this page in a
                couple of minutes and can&apos;t be shown again.
              </p>
              <code className="block break-all rounded bg-background p-2 text-xs">
                {connectorUrl}
              </code>
              <CopyButton text={connectorUrl} label="Copy URL" />
            </div>
          ) : (
            <form action={createMcpTokenAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="returnTo" value="/connect" />
              <div className="space-y-1">
                <Label htmlFor="label">What are you connecting?</Label>
                <Input
                  id="label"
                  name="label"
                  defaultValue="My Claude"
                  required
                  className="w-56"
                />
              </div>
              <Button type="submit">Create connector URL</Button>
            </form>
          )}
          {status.hasToken && !connectorUrl && (
            <p className="text-xs text-muted-foreground">
              Lost the URL? Create a new one here and revoke the old one in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add it to your AI</CardTitle>
          <CardDescription>
            Custom connectors need a paid plan — Claude Pro (or higher) or
            ChatGPT Plus. Menu names change now and then; look for
            &ldquo;Connectors&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Claude</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Open <span className="text-foreground">claude.ai</span> in a
                browser (on a phone, the browser works better than the app
                for this one-time setup) and sign in.
              </li>
              <li>
                Go to <span className="text-foreground">Settings → Connectors</span>{" "}
                and choose{" "}
                <span className="text-foreground">Add custom connector</span>.
              </li>
              <li>
                Name it <span className="text-foreground">Personal CRM</span>,
                paste the URL from step 1, and save. Leave the OAuth fields
                empty.
              </li>
            </ol>
          </div>
          <div>
            <p className="font-medium">ChatGPT</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                In <span className="text-foreground">chatgpt.com</span>, open{" "}
                <span className="text-foreground">Settings → Connectors</span>{" "}
                and turn on <span className="text-foreground">Developer mode</span>{" "}
                under Advanced.
              </li>
              <li>
                Choose <span className="text-foreground">Create</span>, name
                it Personal CRM, paste the URL, set authentication to none,
                and save.
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Try it</CardTitle>
          <CardDescription>
            Start a <strong>new</strong> chat — your AI loads its tools when
            a chat begins, so an old conversation won&apos;t see the CRM.
            Make sure the Personal CRM connector is switched on for that
            chat, then ask:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1">
              What&apos;s pending in my CRM?
            </code>
            <CopyButton text="What's pending in my CRM?" label="Copy question" />
          </div>
          <p className="text-muted-foreground">
            When it answers from your data, you&apos;re done — the box at the
            top of this page turns green the next time you load it. From then
            on, just tell your AI about the people you meet.
          </p>
          <p className="text-muted-foreground">
            Not working? Confirm the connector is enabled in that chat, start
            another new chat, and check the URL was pasted in full. Still
            stuck — create a fresh URL in step 1 and try again.
          </p>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Prefer to type things in by hand? Everything your AI can do, you can
        also do here:{" "}
        <Link href="/contacts/new" className="underline">
          add a contact
        </Link>{" "}
        or{" "}
        <Link href="/interactions/new" className="underline">
          log an interaction
        </Link>
        .
      </p>
    </div>
  );
}
