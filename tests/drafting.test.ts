/**
 * The drafting prompt is the whole product on the drafting path, so its
 * rules are worth asserting directly.
 */
import { describe, expect, it } from "vitest";
import {
  buildDraftInstructions,
  renderDraftContext,
  renderDraftPrompt,
  CHANNEL_SPECS,
  CHANNELS,
  DEFAULT_VOICE_PROFILE,
  type DraftContext,
} from "@/lib/drafting";

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  channel: "email",
  channelLabel: null,
  instruction: null,
  contact: {
    id: "c1",
    name: "Dana Reyes",
    role: "VP Product",
    company: "Northwind",
    location: "Boston",
    howWeMet: "HBS admit weekend",
    relationshipCategory: "Professional",
  },
  followUp: { description: "Send the deck", reason: "She asked after the demo", dueDate: "2026-08-01" },
  intro: null,
  otherOpenFollowUps: [],
  memories: [
    { id: "m1", text: "Taking a sabbatical in September", category: "career", eventDate: "2026-09-01" },
  ],
  lastInteraction: { date: "2026-06-01", type: "coffee", summary: "Talked about the fund" },
  daysSinceLastContact: 40,
  voice: {},
  timezone: "America/New_York",
  ...over,
});

describe("draft prompt", () => {
  it("bans em dashes explicitly", () => {
    const rules = buildDraftInstructions(ctx());
    expect(rules).toMatch(/NO EM DASHES/);
    expect(rules).toContain('"—"');
  });

  it("contains no em dashes itself, on any channel", () => {
    // A prompt that models the habit it forbids teaches the wrong thing:
    // the one allowed occurrence is the rule quoting the character.
    for (const channel of CHANNELS) {
      const text = renderDraftPrompt(ctx({ channel, channelLabel: "LinkedIn DM" }));
      const withoutRule = text
        .split("\n")
        .filter((l) => !l.startsWith("6. NO EM DASHES"))
        .join("\n");
      expect(withoutRule, `em dash leaked into the ${channel} prompt`).not.toContain("—");
    }
  });

  it("passes the ask, the reason and the memories through", () => {
    const text = renderDraftContext(ctx());
    expect(text).toContain("Send the deck");
    expect(text).toContain("She asked after the demo");
    expect(text).toContain("Taking a sabbatical in September");
  });

  it("tells the model not to invent when nothing is recorded", () => {
    const text = renderDraftContext(ctx({ memories: [], lastInteraction: null, daysSinceLastContact: null }));
    expect(text).toMatch(/do not invent specifics/i);
    expect(text).toMatch(/no interactions logged yet/i);
  });

  it("asks for a subject only where the channel has one", () => {
    expect(buildDraftInstructions(ctx({ channel: "email" }))).toMatch(/SUBJECT LINE/);
    expect(buildDraftInstructions(ctx({ channel: "text" }))).not.toMatch(/SUBJECT LINE/);
    expect(CHANNEL_SPECS.text.hasSubject).toBe(false);
    expect(CHANNEL_SPECS.email.hasSubject).toBe(true);
  });

  it("carries a regeneration instruction into the rules", () => {
    const rules = buildDraftInstructions(ctx({ instruction: "shorter, drop the apology" }));
    expect(rules).toContain("shorter, drop the apology");
  });

  it("keeps the message-only rule, which the paste depends on", () => {
    expect(buildDraftInstructions(ctx())).toMatch(/OUTPUT THE MESSAGE ONLY/);
  });
});

describe("voice profile", () => {
  it("passes the user's profile through verbatim", () => {
    const profile =
      "Opens with Hey. Never says circling back. Signs off with just the first name.";
    const rules = buildDraftInstructions(
      ctx({ voice: { voice: profile, signOff: "-Matt", emoji: "never" } }),
    );
    expect(rules).toContain(profile);
    expect(rules).toContain("-Matt");
    expect(rules).toMatch(/HOW THIS PERSON WRITES/);
  });

  it("lets the profile outrank style rules but never the factual ones", () => {
    const rules = buildDraftInstructions(ctx({ voice: { voice: "All lowercase." } }));
    expect(rules).toMatch(/profile outranks every stylistic rule/i);
    expect(rules).toMatch(/does NOT outrank the factual rules/i);
    // Guards against imitation-by-phrase-stuffing, which reads as parody.
    expect(rules).toMatch(/not a script/i);
  });

  it("falls back to a generic profile, never to a specific person", () => {
    const rules = buildDraftInstructions(ctx({ voice: {} }));
    expect(rules).toContain(DEFAULT_VOICE_PROFILE);
    // Each workspace has a different owner. Hardcoding one person's voice as
    // the default would put their words in someone else's drafts.
    expect(DEFAULT_VOICE_PROFILE).not.toMatch(/matt/i);
    expect(DEFAULT_VOICE_PROFILE).not.toContain("—");
  });
});
