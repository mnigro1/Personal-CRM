import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens, users, workspaces } from "@/db/schema";

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Mint a token for a user. The plaintext (returned once, never stored)
 * becomes part of the connector URL: /api/mcp/<token>.
 */
export async function createMcpToken(userId: string, label: string) {
  const token = `crm_${randomBytes(24).toString("base64url")}`;
  await db.insert(mcpTokens).values({
    userId,
    tokenHash: hashToken(token),
    label,
  });
  return token;
}

export async function listMcpTokens(userId: string) {
  return db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
}

/**
 * Has this user's AI ever actually called in? Answers the onboarding
 * question "is it working yet" from the tokens' own last_used_at, so the
 * Home checklist and /connect page need no extra bookkeeping.
 */
export async function connectionStatusFor(userId: string) {
  const rows = await listMcpTokens(userId);
  const lastUsedAt = rows.reduce<Date | null>((latest, t) => {
    if (!t.lastUsedAt) return latest;
    return !latest || t.lastUsedAt > latest ? t.lastUsedAt : latest;
  }, null);
  return { hasToken: rows.length > 0, lastUsedAt };
}

export async function revokeMcpToken(userId: string, tokenId: string) {
  await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.userId, userId)));
}

/**
 * Resolve a plaintext token to its owner and workspace. Returns null for
 * unknown or revoked tokens — the caller responds 401 and nothing else.
 */
export async function resolveMcpToken(token: string) {
  const [row] = await db
    .select({
      tokenId: mcpTokens.id,
      userId: users.id,
      userEmail: users.email,
      timezone: users.timezone,
      settingsJson: users.settingsJson,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .innerJoin(workspaces, eq(workspaces.ownerUserId, users.id))
    .where(
      and(eq(mcpTokens.tokenHash, hashToken(token)), isNull(mcpTokens.revokedAt)),
    );
  if (!row) return null;
  await db
    .update(mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokens.id, row.tokenId));
  return row;
}
