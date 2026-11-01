import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A plain <select> dressed like Input, for server-rendered forms. The styled
 * Select in this folder is a client component with its own state; these
 * forms post straight to a server action, so the native control is the
 * simpler fit — it just needs to stop looking like it came from a
 * different app.
 */
function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
