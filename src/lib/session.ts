import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, workspaces } from "@/db/schema";

export type SessionContext = {
  user: typeof users.$inferSelect;
  workspace: typeof workspaces.$inferSelect;
};

/**
 * Resolves the signed-in user and their workspace, or redirects to /signin.
 * Every server action and page goes through this — the workspace id used for
 * data access only ever comes from the session, never from client input.
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!user) redirect("/signin");

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, user.id));
  if (!workspace) redirect("/signin");

  return { user, workspace };
});
