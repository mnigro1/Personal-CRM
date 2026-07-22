import type { interactions, messageChannel, users } from "@/db/schema";

/**
 * Bump when the rules below change materially — stored on each draft so a
 * draft written under old rules is identifiable, same contract as
 * PROMPT_VERSION in src/lib/proposal.ts.
 */
export const DRAFT_PROMPT_VERSION = "draft-v1";

export type Channel = (typeof messageChannel.enumValues)[number];

export const CHANNELS = [
  "text",
  "slack",
  "teams",
  "email",
  "other",
] as const satisfies readonly Channel[];

type ChannelSpec = {
  label: string;
  /** Contact field that must be present for this channel to be usable. */
  requires?: "phone" | "emails";
  requiresHint?: string;
  hasSubject: boolean;
  /** Soft cap handed to the model and checked in evals. */
  maxChars: number;
  interactionType: (typeof interactions.$inferInsert)["type"];
  rules: string;
};

export const CHANNEL_SPECS: Record<Channel, ChannelSpec> = {
  text: {
    label: "Text",
    requires: "phone",
    requiresHint: "Add a phone number to this contact to draft a text.",
    hasSubject: false,
    maxChars: 320,
    interactionType: "text",
    rules:
      "At most 3 sentences, under 320 characters. No greeting block, no sign-off, no subject. Contractions. One thought only. It should read like a person typing on a phone, not a memo.",
  },
  slack: {
    label: "Slack",
    hasSubject: false,
    maxChars: 700,
    interactionType: "other",
    rules:
      "One or two short paragraphs. A casual opener is fine. No sign-off, no subject line. Plain text — no @-mentions or channel refs.",
  },
  teams: {
    label: "Teams",
    hasSubject: false,
    maxChars: 700,
    interactionType: "other",
    rules:
      "One or two short paragraphs, a half-step more formal than Slack. No sign-off, no subject line.",
  },
  email: {
    label: "Email",
    requires: "emails",
    requiresHint: "Add an email address to this contact to draft an email.",
    hasSubject: true,
    maxChars: 1200,
    interactionType: "email",
    rules:
      'Subject line required: specific and concrete, never "Touching base" or "Quick question". Body is 3-6 sentences with a greeting and the sign-off from the user\'s voice settings.',
  },
  other: {
    label: "Other",
    hasSubject: false,
    maxChars: 700,
    interactionType: "other",
    rules:
      "About 4 sentences, neutral-professional, shaped by the channel label given above.",
  },
};

// --------------------------------------------------------------------- voice

export type DraftingVoice = {
  voice?: string;
  signOff?: string;
  emoji?: "never" | "sparingly" | "yes";
  defaultChannel?: Record<string, Channel>;
};

/** Reads the `drafting` block out of users.settings_json, tolerating junk. */
export function voiceFor(user: typeof users.$inferSelect): DraftingVoice {
  const settings = user.settingsJson;
  if (!settings || typeof settings !== "object") return {};
  const drafting = (settings as Record<string, unknown>).drafting;
  if (!drafting || typeof drafting !== "object") return {};
  return drafting as DraftingVoice;
}

// ------------------------------------------------------------------- context

export type DraftContext = {
  channel: Channel;
  channelLabel: string | null;
  instruction: string | null;
  contact: {
    id: string;
    name: string;
    role: string | null;
    company: string | null;
    location: string | null;
    howWeMet: string | null;
    relationshipCategory: string | null;
  };
  followUp: { description: string; reason: string; dueDate: string | null } | null;
  otherOpenFollowUps: string[];
  memories: { id: string; text: string; category: string; eventDate: string | null }[];
  lastInteraction: { date: string; type: string; summary: string | null } | null;
  daysSinceLastContact: number | null;
  voice: DraftingVoice;
  timezone: string;
};

/**
 * The rules the model follows, returned verbatim in get_draft_context's
 * `instructions` field so the MCP path and any direct-API path can't drift.
 */
export function buildDraftInstructions(ctx: DraftContext): string {
  const spec = CHANNEL_SPECS[ctx.channel];
  const channelName =
    ctx.channel === "other" && ctx.channelLabel
      ? `${spec.label} (${ctx.channelLabel})`
      : spec.label;

  return `You are drafting a message the user will send themselves. Write it in their voice, grounded in the supplied context.

CHANNEL: ${channelName}
${spec.rules}

RULES:
1. GROUND EVERY SPECIFIC. Reference exactly one concrete thing from the supplied memories — the sabbatical, the daughter's application, the thing they were nervous about. Specificity is the entire value here; a message that could have been sent to anyone is a failure even if it reads well.
2. NEVER INVENT. No fact that is not in the context below. No invented mutual friends, no invented dates, no "hope the move went well" if no move is recorded.
3. OWN THE ASK. If the follow-up is a deliverable, say what is coming and when. At most one clause of apology for delay, and only if it is genuinely late.
4. OUTPUT THE MESSAGE ONLY. No preamble, no "Here's a draft:", no alternatives, no commentary. What you return is pasted as-is.
5. STAY UNDER ${spec.maxChars} CHARACTERS. Length is where AI drafts give themselves away.
6. USE THE USER'S VOICE below.${spec.hasSubject ? "\n7. RETURN A SUBJECT LINE as well as a body." : ""}

VOICE: ${ctx.voice.voice?.trim() || "Natural, warm, direct. Contractions. No corporate filler, no “I hope this finds you well”."}
SIGN-OFF: ${ctx.voice.signOff?.trim() || (spec.hasSubject ? "Use the user's first name." : "None — this channel takes no sign-off.")}
EMOJI: ${ctx.voice.emoji ?? "never"}${
    ctx.instruction
      ? `\n\nTHE USER ASKED FOR A REVISION: ${ctx.instruction}\nApply this to the whole message, not just one sentence.`
      : ""
  }

Call save_message_draft with the result. Do not send anything — the user sends it themselves.`;
}

/** Human-readable context block, shared by the MCP tool and the copy-prompt button. */
export function renderDraftContext(ctx: DraftContext): string {
  const lines: string[] = [];
  const c = ctx.contact;

  lines.push(`WHO: ${c.name}${c.role || c.company ? ` — ${[c.role, c.company].filter(Boolean).join(" at ")}` : ""}`);
  if (c.location) lines.push(`WHERE: ${c.location}`);
  if (c.howWeMet) lines.push(`HOW WE MET: ${c.howWeMet}`);
  if (c.relationshipCategory) lines.push(`RELATIONSHIP: ${c.relationshipCategory}`);

  if (ctx.followUp) {
    lines.push("");
    lines.push(`THE ASK: ${ctx.followUp.description}`);
    lines.push(`WHY NOW: ${ctx.followUp.reason}`);
    if (ctx.followUp.dueDate) lines.push(`DUE: ${ctx.followUp.dueDate}`);
  }

  if (ctx.lastInteraction) {
    lines.push("");
    lines.push(
      `LAST SPOKE: ${ctx.lastInteraction.date} (${ctx.lastInteraction.type})${
        ctx.daysSinceLastContact !== null
          ? ` — ${ctx.daysSinceLastContact} days ago`
          : ""
      }`,
    );
    if (ctx.lastInteraction.summary) {
      lines.push(`  ${ctx.lastInteraction.summary}`);
    }
  } else {
    lines.push("");
    lines.push("LAST SPOKE: no interactions logged yet.");
  }

  if (ctx.memories.length > 0) {
    lines.push("");
    lines.push("WHAT I KNOW ABOUT THEM:");
    for (const m of ctx.memories) {
      lines.push(`  - ${m.text}${m.eventDate ? ` (${m.eventDate})` : ""} [${m.category}]`);
    }
  } else {
    lines.push("");
    lines.push(
      "WHAT I KNOW ABOUT THEM: nothing recorded yet — keep the message short and do not invent specifics.",
    );
  }

  if (ctx.otherOpenFollowUps.length > 0) {
    lines.push("");
    lines.push(
      "ALSO OPEN WITH THEM (don't split these across separate messages if one will do):",
    );
    for (const d of ctx.otherOpenFollowUps) lines.push(`  - ${d}`);
  }

  return lines.join("\n");
}

/** The whole thing as one pasteable block, for the copy-prompt escape hatch. */
export function renderDraftPrompt(ctx: DraftContext): string {
  return `${buildDraftInstructions(ctx)}\n\n---\nCONTEXT\n\n${renderDraftContext(ctx)}`;
}

/**
 * Picks the memories worth spending prompt budget on: current facts only,
 * dated events soonest-first (a graduation next month beats a job change from
 * three years ago), then the most recently learned.
 */
export function selectMemories<
  T extends {
    id: string;
    text: string;
    category: string;
    status: string;
    eventDate: string | null;
    createdAt: Date;
  },
>(rows: T[], limit = 8) {
  const current = rows.filter((m) => m.status === "current");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = current
    .filter((m) => m.eventDate && m.eventDate >= today)
    .sort((a, b) => a.eventDate!.localeCompare(b.eventDate!));
  const rest = current
    .filter((m) => !upcoming.includes(m))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return [...upcoming, ...rest].slice(0, limit).map((m) => ({
    id: m.id,
    text: m.text,
    category: m.category,
    eventDate: m.eventDate,
  }));
}
