import { ImageResponse } from "next/og";
import { MARK_INK, MARK_PAPER, markDiscs } from "@/components/brand-mark";
import { SITE_NAME, TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card behind a shared link. Painted once at build time and served from
 * this origin, so the CSP's `img-src 'self'` needs no change. The font that
 * ships inside `next/og` is Geist Regular, the app's own face, so there is
 * no font file to host.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: MARK_PAPER,
          color: MARK_INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="52" height="52" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill={MARK_INK} />
            {markDiscs(MARK_PAPER, MARK_INK)}
          </svg>
          <div style={{ fontSize: 34, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 88,
              lineHeight: 1.04,
              letterSpacing: -3,
              maxWidth: 1000,
            }}
          >
            {TAGLINE}
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.35,
              color: "#737373",
              maxWidth: 940,
            }}
          >
            A private notebook about the people you know. Your AI does the
            typing; the app shows you who to follow up with.
          </div>
        </div>
        <div style={{ fontSize: 24, color: "#737373" }}>Free while in beta</div>
      </div>
    ),
    size,
  );
}
