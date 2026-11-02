import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, GOOGLE_SIGNIN_ENABLED, signIn } from "@/auth";
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
  OAuthSignin: "Google sign-in didn't start. Try again, or use the email link.",
  OAuthCallbackError:
    "Google sign-in didn't complete. Try again, or use the email link.",
  OAuthCallback:
    "Google sign-in didn't complete. Try again, or use the email link.",
  OAuthCreateAccount:
    "We couldn't create your account from Google just now. Try the email link.",
  OAuthAccountNotLinked:
    "That email already has an account. Sign in with the email link once, then Google will work too.",
};
const FALLBACK_ERROR = "Something went wrong signing you in. Please try again.";

/** Google's four-colour mark, inline so no third-party image is loaded. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-4">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

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
            {GOOGLE_SIGNIN_ENABLED
              ? "No password to remember. Continue with Google, or we'll email you a link. New here? Either one sets up your account."
              : "Enter your email and we'll send you a link to sign in — no password needed. New here? The same link sets up your account."}
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
          {GOOGLE_SIGNIN_ENABLED && (
            <>
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: "/" });
                }}
              >
                <Button type="submit" className="w-full gap-2">
                  <GoogleMark />
                  Continue with Google
                </Button>
                <p className="mt-1.5 text-center text-xs text-muted-foreground">
                  Recommended — nothing to wait for in your inbox.
                </p>
              </form>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
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
            <Button
              type="submit"
              variant={GOOGLE_SIGNIN_ENABLED ? "outline" : "default"}
              className="w-full"
            >
              Email me a sign-in link
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
