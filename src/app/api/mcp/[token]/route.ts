import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { repoFor } from "@/db/repo";
import { resolveMcpToken } from "@/db/tokens";
import { registerCrmTools } from "@/lib/mcp-tools";

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

async function handle(req: Request, token: string): Promise<Response> {
  const auth = await resolveMcpToken(token);
  if (!auth) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Invalid or revoked token" },
        id: null,
      },
      { status: 401 },
    );
  }

  const server = new McpServer({ name: "personal-crm", version: "0.1.0" });
  registerCrmTools(server, repoFor(auth.workspaceId), auth.userId);

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
