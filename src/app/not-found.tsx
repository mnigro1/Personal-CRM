import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-semibold">That page doesn&apos;t exist</h1>
        <p className="text-sm text-muted-foreground">
          The link may be old, or the record it pointed at has been removed.
        </p>
        <Button nativeButton={false} render={<Link href="/" />}>
          Go home
        </Button>
      </div>
    </main>
  );
}
