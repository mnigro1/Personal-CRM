"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { autoDetectTimezoneAction } from "@/app/actions";

/**
 * Rendered only while the user has never confirmed a timezone. Asks the
 * browser for its zone once, hands it to the server, and refreshes if that
 * changed anything so every date on the page is right from the first visit.
 * Renders nothing; the server stops rendering it once the zone is confirmed.
 */
export function TimezoneDetect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return;
    autoDetectTimezoneAction(detected)
      .then((changed) => {
        if (!cancelled && changed) router.refresh();
      })
      .catch(() => {
        // Nothing to do: Settings still lets them pick one by hand.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
