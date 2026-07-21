/**
 * Stdio MCP server exposing the CRM to Claude Code / Claude Desktop.
 *
 * Reuses the same workspace-scoped repository layer as the web app, so every
 * query is confined to one workspace — the one belonging to MCP_USER_EMAIL.
 * (The hosted equivalent for claude.ai/ChatGPT lives at /api/mcp/[token].)
 *
 * Run: npm run mcp   (or: npx tsx mcp/server.ts)
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "../.env.local") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { eq } from "drizzle-orm";

async function main() {
  // Imported dynamically so .env.local is loaded before the db pool reads
  // DATABASE_URL.
  const { db } = await import("../src/db");
  const { users, workspaces } = await import("../src/db/schema");
  const { repoFor } = await import("../src/db/repo");
  const { registerCrmTools } = await import("../src/lib/mcp-tools");

  const email = process.env.MCP_USER_EMAIL;
  if (!email) throw new Error("MCP_USER_EMAIL is not set");

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user found for ${email} — sign in to the web app once first`);
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, user.id));
  if (!workspace) throw new Error(`No workspace for ${email}`);

  const server = new McpServer({ name: "personal-crm", version: "0.1.0" });
  registerCrmTools(server, repoFor(workspace.id), user.id);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`personal-crm MCP server ready (workspace: ${workspace.name})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
