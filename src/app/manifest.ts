import type { MetadataRoute } from "next";

/**
 * The point of this file is `display: "browser"`.
 *
 * With no manifest at all, iOS 16.4+ launches a Home Screen entry as a
 * standalone web clip: no address bar, no tab switcher, and content drawn
 * full-bleed under the Dynamic Island. That is indistinguishable from the
 * app having broken, and there is no gesture that brings Safari back.
 *
 * "browser" tells iOS to open Home Screen launches in Safari with its normal
 * chrome. If this ever becomes a real installable app, that is a deliberate
 * change to "standalone" plus a proper safe-area audit, not a default.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal CRM",
    short_name: "CRM",
    description: "Remember the people who matter.",
    start_url: "/",
    display: "browser",
  };
}
