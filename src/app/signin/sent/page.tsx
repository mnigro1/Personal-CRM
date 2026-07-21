import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SentPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            We just emailed you a link. Open the email on this device and tap
            the link to finish signing in.
          </p>
          <p>
            Don&apos;t see it? Check your spam or junk folder — it can take a
            minute to arrive.
          </p>
          {process.env.NODE_ENV !== "production" && (
            <p className="text-xs">
              Dev mode: the link was printed in the terminal running{" "}
              <code>npm run dev</code>.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
