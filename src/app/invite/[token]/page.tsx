import { and, eq, gt, isNull } from "drizzle-orm";
import { signIn } from "@/auth";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.token, token),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        {invite ? (
          <>
            <CardHeader>
              <CardTitle>You&apos;re invited</CardTitle>
              <CardDescription>
                Sign in as <strong>{invite.email}</strong> to create your
                workspace. Your data is fully private — no one else can see it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={async () => {
                  "use server";
                  await signIn("email", { email: invite.email });
                }}
              >
                <Button type="submit" className="w-full">
                  Send me a sign-in link
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <CardHeader>
            <CardTitle>Invite not found</CardTitle>
            <CardDescription>
              This invite link is invalid, expired, or already used.
            </CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  );
}
