"use client";

import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { mergeContactsAction } from "@/app/actions";
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

export type MergeSide = {
  id: string;
  name: string;
  detail: string;
  memories: number;
  interactions: number;
  followUps: number;
};

/**
 * Consolidating two records for one person. The direction matters and isn't
 * always obvious, so it's an explicit choice with the counts shown — and
 * typing MERGE is the gate, because this repoints history and unpicking it
 * by hand is expensive.
 */
export function MergeDialog({ a, b }: { a: MergeSide; b: MergeSide }) {
  const [open, setOpen] = useState(false);
  // Default to keeping whichever record carries more history.
  const weight = (s: MergeSide) => s.memories + s.interactions + s.followUps;
  const [survivorId, setSurvivorId] = useState(
    weight(b) > weight(a) ? b.id : a.id,
  );

  const survivor = survivorId === a.id ? a : b;
  const loser = survivorId === a.id ? b : a;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Merge
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={mergeContactsAction.bind(null, survivor.id, loser.id)}>
          <DialogHeader>
            <DialogTitle>Merge these into one contact</DialogTitle>
            <DialogDescription>
              Everything moves onto the record you keep. Nothing is deleted —
              the other record is archived and still points here.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Which record should survive?
            </p>
            {[a, b].map((side) => (
              <label
                key={side.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/50 ${
                  survivorId === side.id ? "border-ring bg-muted/40" : ""
                }`}
              >
                <input
                  type="radio"
                  name="survivor"
                  checked={survivorId === side.id}
                  onChange={() => setSurvivorId(side.id)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="font-medium">{side.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {side.detail || "No details recorded"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {side.memories} memories · {side.interactions} interactions
                    · {side.followUps} follow-ups
                  </span>
                </span>
              </label>
            ))}
          </div>

          <p className="mb-4 flex flex-wrap items-center gap-1.5 rounded border bg-muted/40 p-2.5 text-xs">
            <span className="font-medium">{loser.name}</span>
            <ArrowRightIcon className="size-3.5" />
            <span className="font-medium">{survivor.name}</span>
            <span className="text-muted-foreground">
              — {loser.memories + loser.interactions + loser.followUps} records
              move across. Blank fields fill in; nothing already on{" "}
              {survivor.name} is overwritten.
            </span>
          </p>

          <div className="mb-4 space-y-1">
            <label htmlFor={`confirm-${a.id}`} className="text-xs font-medium">
              Type MERGE to confirm
            </label>
            <Input
              id={`confirm-${a.id}`}
              name="confirm"
              placeholder="MERGE"
              autoComplete="off"
              required
            />
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm">
              Merge contacts
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
