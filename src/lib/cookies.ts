/**
 * Names of cookies the app sets itself (Auth.js owns its own). A "use server"
 * module can only export functions, so the actions and the pages that read
 * these share them from here.
 */

/**
 * Carries a freshly minted MCP token from the create action to the Settings
 * page exactly once. A cookie rather than a query string so the credential
 * never lands in browser history or request logs.
 */
export const NEW_MCP_TOKEN_COOKIE = "crm_new_mcp_token";
