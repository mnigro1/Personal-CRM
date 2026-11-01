import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { clientIp, consumeRateLimit } from "@/db/rate-limit";
import { repoFor } from "@/db/repo";
import { resolveMcpToken } from "@/db/tokens";
import { buildServerInstructions, registerCrmTools } from "@/lib/mcp-tools";
import { extractionSettingsFor } from "@/lib/user-settings";

/**
 * Hosted MCP endpoint (Streamable HTTP) for remote AI clients — claude.ai
 * custom connectors, ChatGPT developer-mode connectors, or anything that
 * speaks MCP over HTTP.
 *
 * The token in the URL is the credential ("the URL is the secret"): it is
 * minted per user in Settings and resolved server-side to exactly one
 * workspace. A connected AI can never see or touch another workspace.
 *
 * Stateless mode: each request builds a fresh server; no session storage.
 */

export const maxDuration = 60;

// Per token: a Claude session chains tool calls quickly, but not this
// quickly — this only trips a runaway loop. Per IP on bad tokens: the token
// has 192 random bits so guessing is hopeless, this just keeps the noise
// (and the database lookups) down.
const TOKEN_LIMIT = { limit: 300, windowSeconds: 60 };
const BAD_TOKEN_LIMIT = { limit: 20, windowSeconds: 60 };

function rpcError(
  status: number,
  code: number,
  message: string,
  retryAfterSeconds?: number,
) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    {
      status,
      headers: retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
    },
  );
}

async function handle(req: Request, token: string): Promise<Response> {
  const auth = await resolveMcpToken(token);
  if (!auth) {
    const bad = await consumeRateLimit(
      `mcp:badtoken:${clientIp(req.headers)}`,
      BAD_TOKEN_LIMIT,
    );
    if (!bad.allowed)
      return rpcError(429, -32000, "Too many requests", bad.retryAfterSeconds);
    return rpcError(401, -32001, "Invalid or revoked token");
  }

  const limit = await consumeRateLimit(`mcp:token:${auth.tokenId}`, TOKEN_LIMIT);
  if (!limit.allowed) {
    return rpcError(
      429,
      -32000,
      "Rate limit exceeded — wait a moment and try again",
      limit.retryAfterSeconds,
    );
  }

  const { autoApply } = extractionSettingsFor(auth.settingsJson);
  const server = new McpServer(
    { name: "personal-crm", version: "0.1.0" },
    {
      instructions: buildServerInstructions({
        timezone: auth.timezone,
        autoApply,
      }),
    },
  );
  registerCrmTools(server, repoFor(auth.workspaceId), auth.userId, {
    autoApply,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handle(req, token);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handle(req, token);
}

export async function DELETE() {
  // Stateless server: no sessions to terminate.
  return new Response(null, { status: 405 });
}
