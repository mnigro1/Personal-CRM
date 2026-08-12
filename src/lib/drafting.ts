import type { interactions, messageChannel, users } from "@/db/schema";

/**
 * Bump when the rules below change materially — stored on each draft so a
 * draft written under old rules is identifiable, same contract as
 * PROMPT_VERSION in src/lib/proposal.ts.
 */
export const DRAFT_PROMPT_VERSION = "draft-v2";

/**
 * Used only when a user has not written their own profile in Settings.
 * Deliberately generic: every workspace has a different owner, so a specific
 * person's voice must never be the fallback for someone else's drafts.
 */
export const DEFAULT_VOICE_PROFILE = `No profile has been written yet, so aim for plain and human rather than any particular person.
- Short paragraphs, one or two sentences each, with a blank line between them.
- Contractions. Plain words over impressive ones.
- No corporate filler: no "I hope this email finds you well", "reaching out", "circling back", "touching base", "per my last".
- Own the delay plainly if the message is late; one clause, no grovelling.
- Close by inviting a reply, not by assigning homework.`;

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
      "One or two short paragraphs. A casual opener is fine. No sign-off, no subject line. Plain text, with no @-mentions or channel refs.",
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
  /**
   * Set when this draft's follow-up is an intro check-in. Follow-ups stay
   * single-contact, so the counterpart lives here rather than being folded
   * into otherOpenFollowUps, which is scoped to the same person.
   */
  intro: {
    otherPersonName: string;
    reason: string;
    sentAt: string | null;
    outcome: string | null;
  } | null;
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
1. GROUND EVERY SPECIFIC. Reference exactly one concrete thing from the supplied memories (the sabbatical, the daughter's application, the thing they were nervous about). Specificity is the entire value here. A message that could have been sent to anyone is a failure even if it reads well.
2. NEVER INVENT. No fact that is not in the context below. No invented mutual friends, no invented dates, no "hope the move went well" if no move is recorded.
3. OWN THE ASK. If the follow-up is a deliverable, say what is coming and when. At most one clause of apology for delay, and only if it is genuinely late.
4. OUTPUT THE MESSAGE ONLY. No preamble, no "Here's a draft:", no alternatives, no commentary. What you return is pasted as-is.
5. STAY UNDER ${spec.maxChars} CHARACTERS. Length is where AI drafts give themselves away.
6. NO EM DASHES. Never use the character "—". It is the clearest tell that a message was written by an AI, and the user does not write that way. Use a period and a new sentence, a comma, or parentheses instead. Also avoid the semicolon-heavy, perfectly balanced "not X, but Y" construction for the same reason. Short plain sentences read as human.
7. SOUND LIKE THE PERSON SENDING IT. The voice profile below is the most important instruction here after the factual ones. A draft that is accurate but sounds like a generic assistant has failed, because they will rewrite it before sending.${spec.hasSubject ? "\n8. RETURN A SUBJECT LINE as well as a body." : ""}

HOW THIS PERSON WRITES. Match this closely, it is the whole point:
${ctx.voice.voice?.trim() || DEFAULT_VOICE_PROFILE}

SIGN-OFF: ${ctx.voice.signOff?.trim() || (spec.hasSubject ? "Use the user's first name." : "None. This channel takes no sign-off.")}
EMOJI: ${ctx.voice.emoji ?? "never"}

The voice profile outranks every stylistic rule above it. If it says something that contradicts a rule here, follow the profile. It does NOT outrank the factual rules: never invent, and stay grounded in the supplied memories regardless.
Do not imitate the voice by stuffing in its example phrases. Those describe habits, not a script. A message that uses three of the listed tics in four sentences reads as parody, not as the person.${
    ctx.instruction
      ? `\n\nTHE USER ASKED FOR A REVISION: ${ctx.instruction}\nApply this to the whole message, not just one sentence.`
      : ""
  }

Call save_message_draft with the result. Do not send anything. The user sends it themselves.`;
}

/** Human-readable context block, shared by the MCP tool and the copy-prompt button. */
export function renderDraftContext(ctx: DraftContext): string {
  const lines: string[] = [];
  const c = ctx.contact;

  lines.push(`WHO: ${c.name}${c.role || c.company ? `, ${[c.role, c.company].filter(Boolean).join(" at ")}` : ""}`);
  if (c.location) lines.push(`WHERE: ${c.location}`);
  if (c.howWeMet) lines.push(`HOW WE MET: ${c.howWeMet}`);
  if (c.relationshipCategory) lines.push(`RELATIONSHIP: ${c.relationshipCategory}`);

  if (ctx.followUp) {
    lines.push("");
    lines.push(`THE ASK: ${ctx.followUp.description}`);
    lines.push(`WHY NOW: ${ctx.followUp.reason}`);
    if (ctx.followUp.dueDate) lines.push(`DUE: ${ctx.followUp.dueDate}`);
  }

  if (ctx.intro) {
    lines.push("");
    lines.push(
      `THIS IS AN INTRO CHECK-IN. You introduced them to ${ctx.intro.otherPersonName}${
        ctx.intro.sentAt ? ` on ${ctx.intro.sentAt}` : ""
      }.`,
    );
    lines.push(`WHY YOU CONNECTED THEM: ${ctx.intro.reason}`);
    lines.push(
      "Ask whether anything came of it. Keep it light and give them an easy out if nothing did, because most intros go nowhere and that is not a failure on their part.",
    );
  }

  if (ctx.lastInteraction) {
    lines.push("");
    lines.push(
      `LAST SPOKE: ${ctx.lastInteraction.date} (${ctx.lastInteraction.type})${
        ctx.daysSinceLastContact !== null
          ? `, ${ctx.daysSinceLastContact} days ago`
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
      "WHAT I KNOW ABOUT THEM: nothing recorded yet. Keep the message short and do not invent specifics.",
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
