"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/** A TableRow that navigates on click anywhere in the row (not just a link cell). */
export function ClickableRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <TableRow
      onClick={(e) => {
        // Links/buttons inside the row keep their own behavior.
        if ((e.target as HTMLElement).closest("a,button,form,input,select,textarea,label")) return;
        router.push(href);
      }}
      tabIndex={0}
      role="link"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) router.push(href);
      }}
      className="cursor-pointer"
    >
      {children}
    </TableRow>
  );
}
