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

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/**
 * True once the user has picked a timezone in Settings or the browser's was
 * adopted on their first visit. Until then `users.timezone` is only the
 * column default and the app should still be asking the browser.
 */
export function timezoneConfirmed(settingsJson: unknown): boolean {
  return asRecord(settingsJson).timezoneConfirmed === true;
}

export function extractionSettingsFor(settingsJson: unknown): ExtractionSettings {
  const s = asRecord(settingsJson);
  const extraction =
    s.extraction && typeof s.extraction === "object"
      ? (s.extraction as Record<string, unknown>)
      : {};
  // Default on: that is how the product has behaved for every existing user.
  return { autoApply: extraction.autoApply !== false };
}
