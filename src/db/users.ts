import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

type Settings = Record<string, unknown>;

/**
 * Per-user profile writes. Users sit above workspaces, so these don't belong
 * on `repoFor(workspaceId)` — but routing them through here keeps Drizzle
 * tables out of actions all the same.
 */

/** Rewrite users.settings_json through `patch`; the caller owns the nesting. */
export async function updateUserSettings(
  userId: string,
  patch: (current: Settings) => Settings,
) {
  const [user] = await db
    .select({ settingsJson: users.settingsJson })
    .from(users)
    .where(eq(users.id, userId));
  const current =
    user?.settingsJson && typeof user.settingsJson === "object"
      ? (user.settingsJson as Settings)
      : {};
  const next = patch(current);
  await db.update(users).set({ settingsJson: next }).where(eq(users.id, userId));
  return next;
}

export async function updateUserTimezone(userId: string, timezone: string) {
  await db.update(users).set({ timezone }).where(eq(users.id, userId));
}
