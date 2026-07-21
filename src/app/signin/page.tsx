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

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Personal CRM</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a link to sign in — no
            password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
