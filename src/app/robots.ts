import type { MetadataRoute } from "next";

/**
 * Crawlers may index the public pages. The API is not a page, and an invite
 * URL is a one-time credential, so neither belongs in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms", "/signin"],
        disallow: ["/api/", "/invite/"],
      },
    ],
  };
}
