import type { Metadata } from "next";

export const SITE_NAME = "Personal CRM";
export const TAGLINE = "Remember the people who matter.";
export const SITE_DESCRIPTION =
  "A private notebook about the people you know. Tell your AI who you met and what you promised, and see who to follow up with.";

/**
 * The site's public origin, for anything that needs an absolute URL that
 * leaves the app: Open Graph tags, the canonical link, robots.txt.
 *
 * `APP_URL` wins when set. On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` is the
 * production host (no scheme) and is also present on preview deployments,
 * so a link shared from a preview still unfurls against production. The
 * literal is the last resort for a local build with neither.
 *
 * Pages that need the origin of the *current* request (the connector URL on
 * /connect and /settings) keep deriving it from the request headers instead.
 */
function resolveSiteUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "https://personal-crm-teal.vercel.app";
}

export const siteUrl = resolveSiteUrl();

/**
 * Shared Open Graph fields, set once in the root layout. A page that defines
 * its own `openGraph` replaces the layout's object wholesale, including the
 * image that src/app/opengraph-image.tsx attaches at that level, so pages
 * should leave `openGraph` alone unless they also supply `images`.
 */
export const siteOpenGraph = {
  type: "website",
  siteName: SITE_NAME,
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  locale: "en_US",
} satisfies Metadata["openGraph"];
