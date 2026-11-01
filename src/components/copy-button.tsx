"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard and says so for a moment. */
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (http, old browser): the text is selectable.
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
