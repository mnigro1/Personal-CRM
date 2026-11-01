import { ImageResponse } from "next/og";
import { MARK_INK, MARK_PAPER, markDiscs } from "@/components/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Home-screen icon for iOS. Square and full-bleed on purpose: iOS rounds the
 * corners itself, and a transparent margin would show up as a white frame.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: MARK_INK,
        }}
      >
        <svg width="180" height="180" viewBox="0 0 64 64">
          {markDiscs(MARK_PAPER, MARK_INK)}
        </svg>
      </div>
    ),
    size,
  );
}
