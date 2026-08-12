/**
 * Lists existing `type = 'intro'` interactions so you can decide, case by
 * case, which deserve a real intro record.
 *
 * Deliberately read-only. Backfilling automatically would invent opt-in
 * history that never happened and quietly inflate the double opt-in rate,
 * which is the one number this feature exists to keep honest.
 *
 *   npx tsx scripts/list-intro-interactions.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "../.env.local") });

async function main() {
  const { db } = await import("../src/db");
  const { contacts, interactionContacts, interactions, users, workspaces } =
    await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const email = process.env.MCP_USER_EMAIL;
  if (!email) throw new Error("MCP_USER_EMAIL is not set");
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user for ${email}`);
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, user.id));
  if (!workspace) throw new Error(`No workspace for ${email}`);

  const rows = await db
    .select()
    .from(interactions)
    .where(
      and(
        eq(interactions.workspaceId, workspace.id),
        eq(interactions.type, "intro"),
      ),
    )
    .orderBy(interactions.occurredAt);

  if (rows.length === 0) {
    console.log("No interactions with type = 'intro'.");
    return;
  }

  console.log(`${rows.length} intro-typed interaction(s):\n`);
  for (const i of rows) {
    const people = await db
      .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName })
      .from(interactionContacts)
      .innerJoin(contacts, eq(contacts.id, interactionContacts.contactId))
      .where(eq(interactionContacts.interactionId, i.id));

    console.log("=".repeat(72));
    console.log(`date:        ${i.occurredAt.toISOString().slice(0, 10)}`);
    console.log(
      `linked:      ${
        people.map((p) => `${p.first} ${p.last ?? ""}`.trim()).join(", ") ||
        "(nobody linked)"
      }`,
    );
    console.log(`contact ids: ${people.map((p) => p.id).join(" ") || "-"}`);
    console.log(`interaction: ${i.id}`);
    console.log(`source:      ${i.rawSource.slice(0, 300).replace(/\n/g, " ")}`);
    if (people.length === 2) {
      console.log(
        `\n  If this was a real intro:\n` +
          `    log_intro personAContactId=${people[0].id} personBContactId=${people[1].id}\n` +
          `      reason="<why you connected them>" sentAt="${i.occurredAt.toISOString()}"\n` +
          `      introInteractionId=${i.id}\n` +
          `    Add aOptedInAt/bOptedInAt ONLY if you actually asked them first.`,
      );
    } else {
      console.log(
        `\n  ${people.length} people linked, so the two sides are ambiguous. Decide by hand.`,
      );
    }
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
