import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  extractions,
  followUps,
  interactionContacts,
  interactions,
  intros,
  memories,
  messageDrafts,
  revisions,
} from "@/db/schema";

/**
 * Right to access: the workspace as plain rows, for the download in
 * Settings → Your data.
 *
 * Nothing is filtered or reshaped. Soft-deleted and merged contacts come out
 * with `deletedAt` / `mergedIntoContactId` set rather than being dropped, so
 * the file is what the database holds, not what the UI chooses to show.
 *
 * Every table that carries user data belongs here AND in `deleteUserAccount`
 * (src/db/users.ts). Add a table to one, add it to the other, same change.
 */
export function exportOpsFor(workspaceId: string) {
  return {
    async exportWorkspace() {
      // One query at a time on the pooled connection: a burst of parallel
      // queries would open a connection each in a cold serverless function,
      // and the handshakes cost more than the queries.
      const contactRows = await db
        .select()
        .from(contacts)
        .where(eq(contacts.workspaceId, workspaceId))
        .orderBy(asc(contacts.createdAt));
      const interactionRows = await db
        .select()
        .from(interactions)
        .where(eq(interactions.workspaceId, workspaceId))
        .orderBy(asc(interactions.occurredAt));
      const linkRows = await db
        .select()
        .from(interactionContacts)
        .where(eq(interactionContacts.workspaceId, workspaceId));
      const memoryRows = await db
        .select()
        .from(memories)
        .where(eq(memories.workspaceId, workspaceId))
        .orderBy(asc(memories.createdAt));
      const followUpRows = await db
        .select()
        .from(followUps)
        .where(eq(followUps.workspaceId, workspaceId))
        .orderBy(asc(followUps.createdAt));
      const introRows = await db
        .select()
        .from(intros)
        .where(eq(intros.workspaceId, workspaceId))
        .orderBy(asc(intros.createdAt));
      const draftRows = await db
        .select()
        .from(messageDrafts)
        .where(eq(messageDrafts.workspaceId, workspaceId))
        .orderBy(asc(messageDrafts.requestedAt));
      const extractionRows = await db
        .select()
        .from(extractions)
        .where(eq(extractions.workspaceId, workspaceId))
        .orderBy(asc(extractions.createdAt));
      const revisionRows = await db
        .select()
        .from(revisions)
        .where(eq(revisions.workspaceId, workspaceId))
        .orderBy(asc(revisions.createdAt));

      return {
        contacts: contactRows,
        interactions: interactionRows,
        interactionContacts: linkRows,
        memories: memoryRows,
        followUps: followUpRows,
        intros: introRows,
        messageDrafts: draftRows,
        extractions: extractionRows,
        revisions: revisionRows,
      };
    },
  };
}

export type WorkspaceExport = Awaited<
  ReturnType<ReturnType<typeof exportOpsFor>["exportWorkspace"]>
>;
