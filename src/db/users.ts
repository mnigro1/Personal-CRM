import { eq, inArray, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  accounts,
  contactTags,
  contacts,
  extractions,
  followUps,
  interactionContacts,
  interactions,
  intros,
  invites,
  mcpTokens,
  memories,
  messageDrafts,
  rateLimits,
  revisions,
  sessions,
  tags,
  users,
  verificationTokens,
  workspaces,
} from "@/db/schema";

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

/**
 * Erase a user and everything they own. For good.
 *
 * This is THE hard delete in the codebase (AGENTS.md): everywhere else a
 * contact is tombstoned and a merge leaves a pointer behind, because history
 * is the product. Here the user has asked for the opposite, so every row
 * goes: the workspace's data, the workspace, their connector tokens (the AI
 * is cut off the instant this commits), invites they sent and the one that
 * let them in, their sessions and sign-in tokens, and finally the user row.
 *
 * One transaction, children before parents in foreign-key order, so a crash
 * halfway can't leave a half-deleted account. No email, no retention copy.
 * Every new table that carries user data belongs here AND in
 * `exportWorkspace` (src/db/repo-export.ts), in the same change.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return; // Already gone; nothing to do and nothing to fail on.

    const workspaceIds = (
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, userId))
    ).map((w) => w.id);

    if (workspaceIds.length > 0) {
      const inWorkspace = (col: PgColumn) => inArray(col, workspaceIds);
      // Leaves first. Each line only depends on the ones below it.
      await tx.delete(revisions).where(inWorkspace(revisions.workspaceId));
      await tx.delete(extractions).where(inWorkspace(extractions.workspaceId));
      await tx
        .delete(messageDrafts)
        .where(inWorkspace(messageDrafts.workspaceId));
      await tx.delete(followUps).where(inWorkspace(followUps.workspaceId));
      await tx.delete(intros).where(inWorkspace(intros.workspaceId));
      await tx.delete(memories).where(inWorkspace(memories.workspaceId));
      await tx
        .delete(interactionContacts)
        .where(inWorkspace(interactionContacts.workspaceId));
      await tx
        .delete(interactions)
        .where(inWorkspace(interactions.workspaceId));
      await tx.delete(contactTags).where(inWorkspace(contactTags.workspaceId));
      await tx.delete(tags).where(inWorkspace(tags.workspaceId));
      await tx.delete(contacts).where(inWorkspace(contacts.workspaceId));
      await tx.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    }

    // revisions.actor_user_id has no cascade. A user only ever acts in their
    // own workspace, so this should match nothing; if it ever does, keep the
    // other workspace's history and just drop the reference to this person.
    await tx
      .update(revisions)
      .set({ actorUserId: null })
      .where(eq(revisions.actorUserId, userId));

    await tx.delete(mcpTokens).where(eq(mcpTokens.userId, userId));
    // Invites they sent, and the one addressed to them: both carry an email.
    await tx
      .delete(invites)
      .where(
        or(eq(invites.invitedByUserId, userId), eq(invites.email, user.email)),
      );
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, user.email));
    // Limiter rows are keyed by address and id; they would name the person
    // for up to a day after they left.
    await tx
      .delete(rateLimits)
      .where(
        inArray(rateLimits.key, [
          `signin:email:${user.email}`,
          `export:${userId}`,
        ]),
      );
    await tx.delete(users).where(eq(users.id, userId));
  });
}
