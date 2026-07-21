import Link from "next/link";
import { signOut } from "@/auth";
import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireSession();

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <nav className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Personal CRM
            </Link>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              Contacts
            </Link>
            <Link href="/interactions" className="text-sm text-muted-foreground hover:text-foreground">
              Interactions
            </Link>
            <Link href="/tags" className="text-sm text-muted-foreground hover:text-foreground">
              Tags
            </Link>
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
              Settings
            </Link>
          </nav>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
            className="flex items-center gap-3"
          >
            <span className="text-sm text-muted-foreground">{user.email}</span>
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
