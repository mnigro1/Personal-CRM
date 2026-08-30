"use client";

import { useState } from "react";
import {
  closeIntroAction,
  markIntroSentAction,
  recordIntroOptInAction,
  recordIntroOutcomeAction,
} from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
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
import { CHANNELS } from "@/lib/drafting";

type Person = { id: string; name: string };

const OUTCOMES: { value: string; label: string }[] = [
  { value: "no_response", label: "No response" },
  { value: "met_once", label: "Met once" },
  { value: "ongoing", label: "Ongoing relationship" },
  { value: "opportunity", label: "Led to an opportunity" },
  { value: "unknown", label: "Not sure" },
];

/**
 * Everything you can do to one intro from the list, adapted to its current
 * status. Opt-ins are one-directional (recordOptIn only ever sets a
 * timestamp forward, never clears one) so an already-opted-in person renders
 * as a static check, not a toggle.
 */
export function IntroActions({
  introId,
  personA,
  personB,
  aOptedIn,
  bOptedIn,
  status,
}: {
  introId: string;
  personA: Person;
  personB: Person;
  aOptedIn: boolean;
  bOptedIn: boolean;
  status: string;
}) {
  const terminal = ["completed", "declined", "abandoned"].includes(status);
  if (terminal) return null;

  if (status === "sent") {
    return <RecordOutcomeDialog introId={introId} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!aOptedIn && (
        <form action={recordIntroOptInAction.bind(null, introId, personA.id)}>
          <Button type="submit" size="sm" variant="outline">
            {personA.name} opted in
          </Button>
        </form>
      )}
      {!bOptedIn && (
        <form action={recordIntroOptInAction.bind(null, introId, personB.id)}>
          <Button type="submit" size="sm" variant="outline">
            {personB.name} opted in
          </Button>
        </form>
      )}
      <MarkSentDialog
        introId={introId}
        bothOptedIn={aOptedIn && bOptedIn}
      />
      <form action={closeIntroAction.bind(null, introId, "declined")}>
        <ConfirmButton
          size="sm"
          variant="outline"
          message="Mark this intro declined?"
        >
          Decline
        </ConfirmButton>
      </form>
    </div>
  );
}

function MarkSentDialog({
  introId,
  bothOptedIn,
}: {
  introId: string;
  bothOptedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Mark sent</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={markIntroSentAction.bind(null, introId)}>
          <DialogHeader>
            <DialogTitle>Mark this intro sent</DialogTitle>
            <DialogDescription>
              {bothOptedIn
                ? "Both people opted in — this will count toward your double opt-in rate."
                : "Not both people have opted in yet. Sending now won't count toward your double opt-in rate unless you force it."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Channel
              <select
                name="channel"
                className="mt-1 w-full rounded border px-2 py-2 text-sm"
                defaultValue="email"
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            {!bothOptedIn && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="force" className="mt-0.5" />
                <span>
                  Send anyway. This still logs the intro, but it fails the
                  double opt-in check and won&apos;t count toward your goal.
                </span>
              </label>
            )}
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm">
              Mark sent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordOutcomeDialog({ introId }: { introId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        Record outcome
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={recordIntroOutcomeAction.bind(null, introId)}>
          <DialogHeader>
            <DialogTitle>What happened?</DialogTitle>
            <DialogDescription>
              This closes out the 30-day check-in follow-up too.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3">
            <select
              name="outcome"
              className="w-full rounded border px-2 py-2 text-sm"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select an outcome…
              </option>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Textarea name="note" rows={3} placeholder="Any detail worth keeping (optional)" />
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm">
              Save outcome
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
