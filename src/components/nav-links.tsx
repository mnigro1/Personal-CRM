"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/contacts", label: "Contacts", match: (p: string) => p.startsWith("/contacts") },
  { href: "/interactions", label: "Interactions", match: (p: string) => p.startsWith("/interactions") },
  { href: "/review", label: "Review", match: (p: string) => p.startsWith("/review") },
  { href: "/tags", label: "Tags", match: (p: string) => p.startsWith("/tags") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function NavLinks({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();

  return (
    <>
      {links.map(({ href, label, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1 border-b-2 py-1 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {label === "Review" && reviewCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}
