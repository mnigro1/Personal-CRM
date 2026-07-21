"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TableRow } from "@/components/ui/table";

/**
 * A table row that opens `href` on click anywhere in it, and shows a
 * right-click menu with Open / Edit / Delete when those are provided.
 */
export function ClickableRow({
  href,
  editHref,
  deleteAction,
  deleteMessage,
  children,
}: {
  href: string;
  editHref?: string;
  deleteAction?: () => Promise<void>;
  deleteMessage?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const row = (
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

  if (!editHref && !deleteAction) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => router.push(href)}>
          Open
        </ContextMenuItem>
        {editHref && (
          <ContextMenuItem onClick={() => router.push(editHref)}>
            Edit
          </ContextMenuItem>
        )}
        {deleteAction && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => {
                if (window.confirm(deleteMessage ?? "Delete this?")) {
                  startTransition(() => deleteAction());
                }
              }}
            >
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
