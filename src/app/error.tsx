"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Catches anything thrown while rendering a page or running an action, so
 * users get a calm page with a way back instead of a bare framework error.
 * Production hides the message on purpose (it may contain internals); the
 * digest is the correlation id for the server log.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Your data is safe — nothing is lost by trying again. If this keeps
          happening, note the time and the reference below and let us know.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
            Go home
          </Button>
        </div>
      </div>
    </main>
  );
}
