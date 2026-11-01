import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";

/**
 * The invite behind a /invite/<token> link, if it is still open. Looked up
 * without a session on purpose: the link itself is what the invitee holds.
 */
export async function findOpenInvite(token: string) {
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.token, token),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );
  return invite ?? null;
}
