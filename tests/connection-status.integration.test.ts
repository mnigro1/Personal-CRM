/**
 * The "is my AI connected yet" signal behind the Home checklist and the
 * /connect page. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("connection status (integration)", async () => {
  const { db } = await import("@/db");
  const { mcpTokens, users, workspaces } = await import("@/db/schema");
  const { connectionStatusFor, createMcpToken, resolveMcpToken, revokeMcpToken, listMcpTokens } =
    await import("@/db/tokens");

  const run = Date.now();
  let userId: string;
  let wsId: string;

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `conn-${run}@example.test` })
      .returning();
    userId = u.id;
    const [w] = await db
      .insert(workspaces)
      .values({ ownerUserId: userId, name: "Conn" })
      .returning();
    wsId = w.id;
  });

  afterAll(async () => {
    await db.delete(mcpTokens).where(eq(mcpTokens.userId, userId));
    await db.delete(workspaces).where(eq(workspaces.id, wsId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("goes nothing → token exists → AI called in → revoked", async () => {
    expect(await connectionStatusFor(userId)).toEqual({ hasToken: false, lastUsedAt: null });

    const token = await createMcpToken(userId, "test");
    expect(await connectionStatusFor(userId)).toEqual({ hasToken: true, lastUsedAt: null });

    // Resolving the token is exactly what the MCP route does on every call.
    expect(await resolveMcpToken(token)).not.toBeNull();
    const used = await connectionStatusFor(userId);
    expect(used.hasToken).toBe(true);
    expect(used.lastUsedAt).toBeInstanceOf(Date);

    const [row] = await listMcpTokens(userId);
    await revokeMcpToken(userId, row.id);
    expect(await connectionStatusFor(userId)).toEqual({ hasToken: false, lastUsedAt: null });
  });
});
