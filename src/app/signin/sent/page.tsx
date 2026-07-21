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
        <CardContent className="text-sm text-muted-foreground">
          A sign-in link has been sent. In development, it&apos;s printed in
          the terminal running <code>npm run dev</code>.
        </CardContent>
      </Card>
    </main>
  );
}
