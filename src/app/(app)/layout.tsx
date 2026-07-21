import { signOut } from "@/auth";
import { NavLinks } from "@/components/nav-links";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";
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

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
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
    </div>
  );
}
