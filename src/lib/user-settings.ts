/**
 * Typed readers for users.settings_json. The column is free-form JSON, so
 * every consumer narrows it here instead of reaching into it ad hoc.
 * (`voiceFor` in lib/drafting.ts and the intros goal read the same blob.)
 */

export type ExtractionSettings = {
  /**
   * Whether the connected AI applies non-blocked extraction proposals on its
   * own. Off means every proposal waits for the web review screen (or an
   * explicit "apply" in chat). Blocked items — ambiguous people, proposed new
   * contacts — always wait, whatever this says.
   */
  autoApply: boolean;
};

export function extractionSettingsFor(settingsJson: unknown): ExtractionSettings {
  const s =
    settingsJson && typeof settingsJson === "object"
      ? (settingsJson as Record<string, unknown>)
      : {};
  const extraction =
    s.extraction && typeof s.extraction === "object"
      ? (s.extraction as Record<string, unknown>)
      : {};
  // Default on: that is how the product has behaved for every existing user.
  return { autoApply: extraction.autoApply !== false };
}
