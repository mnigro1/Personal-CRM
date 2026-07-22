"use client";

import { useState } from "react";
import { resolveFollowUpAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Outcome = "as_written" | "different" | "other_channel";

/**
 * THE completion control — every Done in the app is this dialog, whether the
 * follow-up has a draft, an unwritten draft, or no draft at all (spec §1).
 * One question — what actually happened? — because a real outreach that
 * skips Layer 1 leaves a hole in history, and an unsent AI draft that lands
 * in Layer 1 fabricates it.
 *
 * Options adapt to the state:
 * - written draft:   as-written / pasted-different / another-way
 * - unwritten draft: pasted / another-way ("as written" has nothing to describe)
 * - no draft:        pasted / just-done
 *
 * Only "as written" or pasted text ever produces an interaction. Nothing
 * here fires on copy, deep-link, or navigation — an explicit click, always.
 */
export function DoneDialog({
  followUpId,
  contactId,
  draftId = null,
  hasBody = false,
  returnTo,
  triggerLabel = "Done",
  triggerVariant = "outline",
}: {
  followUpId: string | null;
  contactId: string;
  draftId?: string | null;
  hasBody?: boolean;
  returnTo: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
}) {
  const hasDraft = draftId !== null;
  const [open, setOpen] = useState(false);
  // Best-guess default: a written draft was probably sent as-is; otherwise
  // the likeliest truth is that no loggable message exists.
  const [outcome, setOutcome] = useState<Outcome>(
    hasBody ? "as_written" : "other_channel",
  );

  const options: { value: Outcome; label: string; hint: string }[] = [
    ...(hasBody
      ? [
          {
            value: "as_written" as const,
            label: "Sent it as written",
            hint: "Logs this message to their history, word for word.",
          },
        ]
      : []),
    {
      value: "different",
      label: hasBody ? "Sent something different" : "I sent them a message",
      hint: "Paste what you actually sent, or leave it blank to log nothing.",
    },
    {
      value: "other_channel",
      label: hasDraft ? "Reached out another way" : "Just mark it done",
      hint: hasDraft
        ? "Called, met up, wrote it fresh somewhere else. Nothing is logged."
        : "Handled outside a message, or simply done. Nothing is logged.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={triggerVariant} />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          action={resolveFollowUpAction.bind(null, {
            draftId,
            followUpId,
            contactId,
            returnTo,
          })}
        >
          <DialogHeader>
            <DialogTitle>
              {hasDraft ? "What did you actually send?" : "How did this get done?"}
            </DialogTitle>
            <DialogDescription>
              {hasBody
                ? "Only what really went out gets saved to their history."
                : hasDraft
                  ? "There's a draft in flight for this one that was never written. Only what really went out gets saved to their history."
                  : "If you sent them something, you can save it to their history — otherwise just close it out."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            {options.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/50 ${
                  outcome === o.value ? "border-ring bg-muted/40" : ""
                }`}
              >
                <input
                  type="radio"
                  name="outcome"
                  value={o.value}
                  checked={outcome === o.value}
                  onChange={() => setOutcome(o.value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {outcome === "different" && (
            // Deliberately empty, never prefilled with the draft: prefilling
            // would make "click through" fabricate a record, which is the
            // exact thing this option exists to prevent.
            <Textarea
              name="sentText"
              rows={5}
              placeholder="Paste what you actually sent (optional — blank logs nothing)"
              className="mb-4"
            />
          )}

          <p className="mb-4 text-xs text-muted-foreground">
            {followUpId
              ? "The follow-up gets marked done either way."
              : "No follow-up attached to this draft."}
          </p>

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm">
              Done
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
