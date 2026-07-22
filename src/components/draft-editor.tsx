"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, UndoIcon } from "lucide-react";
import { saveDraftTextAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_SPECS, type Channel } from "@/lib/drafting";

const AUTOSAVE_MS = 800;

/**
 * The draft is the user's the moment it exists — a live textarea, not a
 * read-only block behind an Edit button. Autosaves on a debounce so there is
 * no Save button to forget, and editing never advances status (spec §1).
 *
 * The save must also FLUSH on blur, not just debounce: clicking "Mark sent"
 * blurs this field, and Next serializes server actions per client, so the
 * flushed write is guaranteed to land before markDraftSent reads the body.
 * Without this, an edit made <800ms before Mark sent would log stale text
 * into immutable Layer 1.
 */
export function DraftEditor({
  draftId,
  channel,
  initialBody,
  initialSubject,
  aiBody,
  phone,
  email,
}: {
  draftId: string;
  channel: Channel;
  initialBody: string;
  initialSubject: string;
  aiBody: string;
  phone: string | null;
  email: string | null;
}) {
  const spec = CHANNEL_SPECS[channel];
  const [body, setBody] = useState(initialBody);
  const [subject, setSubject] = useState(initialSubject);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">(
    "saved",
  );
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The not-yet-persisted values, if any. Single source of truth for flush.
  const pendingRef = useRef<{ body: string; subject: string } | null>(null);

  const dirty = body !== aiBody;
  const overCap = body.length > spec.maxChars;

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (timer.current) clearTimeout(timer.current);
    const ok = await saveDraftTextAction(
      draftId,
      pending.body,
      spec.hasSubject ? pending.subject : null,
    );
    // A newer edit may have queued while this one was in flight — that edit
    // owns the indicator now; don't stomp its "saving".
    if (!pendingRef.current) setSaveState(ok ? "saved" : "failed");
  }, [draftId, spec.hasSubject]);

  const queueSave = useCallback(
    (nextBody: string, nextSubject: string) => {
      setSaveState("saving");
      pendingRef.current = { body: nextBody, subject: nextSubject };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  // Last-ditch flush if the component unmounts with an edit still pending
  // (fire-and-forget — blur has already covered every click-driven path).
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const revert = () => {
    setBody(aiBody);
    queueSave(aiBody, subject);
  };

  // Only mailto reliably prefills. sms: is inconsistent across platforms and
  // Slack/Teams deep links can't carry body text at all, so those get no
  // "open in app" button rather than a promise that silently fails.
  const deepLink =
    channel === "email" && email
      ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
          subject,
        )}&body=${encodeURIComponent(body)}`
      : channel === "text" && phone
        ? `sms:${phone.replace(/[^\d+]/g, "")}`
        : null;

  return (
    <div className="space-y-3">
      {spec.hasSubject && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <Input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              queueSave(body, e.target.value);
            }}
            onBlur={() => void flush()}
            placeholder="Subject line"
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <span
            className={`text-xs ${
              overCap ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {body.length}/{spec.maxChars}
          </span>
        </div>
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            queueSave(e.target.value, subject);
          }}
          onBlur={() => void flush()}
          rows={8}
          className="min-h-40 font-normal"
        />
        <p
          className={`text-xs ${
            saveState === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {saveState === "saved" && "Saved"}
          {saveState === "saving" && "Saving…"}
          {saveState === "failed" &&
            "Couldn't save — the draft may have changed elsewhere. Reload before sending."}
          {dirty && saveState !== "failed" && " · edited"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy} type="button">
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy message"}
        </Button>
        {deepLink && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={deepLink} />}
          >
            Open in {channel === "email" ? "mail" : "Messages"}
          </Button>
        )}
        {dirty && (
          <Button variant="ghost" size="sm" onClick={revert} type="button">
            <UndoIcon />
            Revert to original
          </Button>
        )}
      </div>
    </div>
  );
}
