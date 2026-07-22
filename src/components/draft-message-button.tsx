"use client";

import { useState } from "react";
import Link from "next/link";
import { createDraftAction } from "@/app/actions";
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
import { Input } from "@/components/ui/input";
import { CHANNELS, CHANNEL_SPECS, type Channel } from "@/lib/drafting";

/**
 * "Draft message" on a follow-up row. Shows on every open follow-up — no
 * classification of who owes whom, because misclassifying hides the button on
 * the one thing you most needed to send (spec §1).
 */
export function DraftMessageButton({
  contactId,
  followUpId,
  contactName,
  hasPhone,
  hasEmail,
  existingDraftId,
}: {
  contactId: string;
  followUpId: string;
  contactName: string;
  hasPhone: boolean;
  hasEmail: boolean;
  existingDraftId?: string;
}) {
  const [open, setOpen] = useState(false);
  // Default to the first channel this contact can actually receive — a
  // disabled default submits no value at all.
  const [channel, setChannel] = useState<Channel>(
    hasPhone ? "text" : hasEmail ? "email" : "slack",
  );

  // A draft already in flight — go to it rather than starting a second one.
  if (existingDraftId) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={`/drafts/${existingDraftId}`} />}
      >
        Open draft
      </Button>
    );
  }

  const unavailable = (c: Channel) => {
    const spec = CHANNEL_SPECS[c];
    if (spec.requires === "phone" && !hasPhone) return spec.requiresHint;
    if (spec.requires === "emails" && !hasEmail) return spec.requiresHint;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Draft message
      </DialogTrigger>
      <DialogContent>
        <form action={createDraftAction.bind(null, contactId, followUpId)}>
          <DialogHeader>
            <DialogTitle>Draft a message to {contactName}</DialogTitle>
            <DialogDescription>
              How are you sending it? That decides the length and tone.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            {CHANNELS.map((c) => {
              const blocked = unavailable(c);
              return (
                <label
                  key={c}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-sm ${
                    blocked
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-muted/50"
                  } ${channel === c && !blocked ? "border-ring bg-muted/40" : ""}`}
                >
                  <input
                    type="radio"
                    name="channel"
                    value={c}
                    disabled={!!blocked}
                    checked={channel === c}
                    onChange={() => setChannel(c)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{CHANNEL_SPECS[c].label}</span>
                    {blocked && (
                      <span className="block text-xs text-muted-foreground">
                        {blocked}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {channel === "other" && (
            <Input
              name="channelLabel"
              placeholder="LinkedIn DM, WhatsApp, Signal…"
              required
              className="mb-4"
            />
          )}

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm">
              Draft it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
