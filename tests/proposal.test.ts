import { describe, expect, it } from "vitest";
import {
  proposalSchema,
  selectAllDefaults,
  selectionsSchema,
  type StagedProposal,
} from "@/lib/proposal";

describe("proposalSchema", () => {
  it("accepts a minimal valid proposal with defaults", () => {
    const p = proposalSchema.parse({});
    expect(p.new_memories).toEqual([]);
    expect(p.contact_bindings).toEqual([]);
  });

  it("rejects malformed shapes (spec: malformed-response handling)", () => {
    expect(() => proposalSchema.parse({ new_memories: "nope" })).toThrow();
    expect(() =>
      proposalSchema.parse({ follow_ups: [{ contact: "x", description: "d" }] }),
    ).toThrow(); // reason is required
    expect(() =>
      proposalSchema.parse({
        supersessions: [{ existing_memory_id: "not-a-uuid", reason: "r", replacement_memory_index: 0 }],
      }),
    ).toThrow();
  });
});

describe("selectAllDefaults", () => {
  it("pre-deselects probable duplicates only", () => {
    const staged: StagedProposal = {
      proposal: proposalSchema.parse({
        new_memories: [
          { contact: "0b7f8e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", text: "a" },
          { contact: "0b7f8e9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", text: "b" },
        ],
      }),
      flags: {
        new_memories: {
          0: { probableDuplicate: true, matchMemoryId: "x", matchText: "a", similarity: 0.9 },
        },
      },
    };
    const s = selectAllDefaults(staged);
    expect(s.new_memories).toEqual([1]);
  });
});

describe("selectionsSchema", () => {
  it("parses chat-style selections with binding resolutions", () => {
    const s = selectionsSchema.parse({
      binding_resolutions: { Jordan: "create", Sarah: "skip" },
      new_memories: [0, 2],
    });
    expect(s.binding_resolutions.Jordan).toBe("create");
    expect(s.interaction_meta).toBe(true);
  });
});
