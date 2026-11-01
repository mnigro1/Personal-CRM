import Link from "next/link";
import { signOut } from "@/auth";
import { NavLinks } from "@/components/nav-links";
import { TimezoneDetect } from "@/components/timezone-detect";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";
import { timezoneConfirmed } from "@/lib/user-settings";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const [pending, proposed] = await Promise.all([
    repo.listPendingCaptures(),
    repo.listProposedExtractions(),
  ]);
  const reviewCount = pending.length + proposed.length;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  return (
    // svh, not dvh: dvh grows when Safari hides its toolbars, which makes the
    // page taller exactly as you scroll and keeps the chrome hidden. The
    // inset padding keeps content clear of the Dynamic Island and home bar
    // whenever Safari draws full-bleed.
    <div className="min-h-svh pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <nav className="flex max-w-full items-center gap-4 overflow-x-auto sm:gap-6">
            <span className="hidden cursor-default font-semibold select-none md:inline">
              Personal CRM
            </span>
            <NavLinks reviewCount={reviewCount} />
          </nav>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
            className="flex items-center gap-3"
          >
            <span className="hidden text-sm text-muted-foreground lg:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
      <footer className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 pb-6 pt-8 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        {supportEmail && (
          <a href={`mailto:${supportEmail}`} className="hover:text-foreground">
            Support
          </a>
        )}
      </footer>
      {!timezoneConfirmed(user.settingsJson) && <TimezoneDetect />}
    </div>
  );
}
