import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
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

export const metadata: Metadata = { title: "Sign in" };

// Auth.js sends every failure here as ?error=<type>. Each gets a sentence a
// person can act on; the raw type name told them nothing.
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "We couldn't sign you in with that address. Check it for typos and try again.",
  RateLimited:
    "Too many sign-in links requested. Check your inbox for one that's already there, or try again in 15 minutes.",
  Busy:
    "Sign-in is unusually busy right now and we've paused sending links for a little while. Please try again later today.",
  Verification:
    "That sign-in link has expired or was already used. Request a fresh one below.",
  EmailSignin:
    "We couldn't send the email just now. Wait a minute and try again.",
};
const FALLBACK_ERROR = "Something went wrong signing you in. Please try again.";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error, deleted } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? FALLBACK_ERROR) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Personal CRM</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a link to sign in — no
            password needed. New here? The same link sets up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deleted === "1" && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
            >
              Your account and all of its data have been deleted.
            </p>
          )}
          {message && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              {message}
            </p>
          )}
          <form
            action={async (formData: FormData) => {
              "use server";
              await signIn("email", formData);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <Button type="submit" className="w-full">
              Send me a sign-in link
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to the{" "}
              <Link href="/terms" className="underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
              .
            </p>
            {process.env.NODE_ENV !== "production" && (
              <p className="text-center text-xs text-muted-foreground">
                Dev mode: the link will print in this terminal instead of
                being emailed.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
