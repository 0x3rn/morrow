"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/competitors", label: "Competitors" },
  { href: "/dashboard/changes", label: "Change history" },
  { href: "/dashboard/notifications", label: "Notifications" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function WorkspaceNav() {
  const pathname = usePathname();
  const selected = pathname.startsWith("/dashboard/billing")
    ? "/dashboard/billing"
    : pathname.startsWith("/dashboard/team")
      ? "/dashboard/team"
      : pathname.startsWith("/dashboard/notifications")
        ? "/dashboard/notifications"
        : pathname.startsWith("/dashboard/changes")
          ? "/dashboard/changes"
          : pathname.startsWith("/dashboard/competitors") || pathname.startsWith("/dashboard/pages")
            ? "/dashboard/competitors"
            : "/dashboard";

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {destinations.map(({ href, label }) => (
        <Link key={href} href={href} prefetch={false} aria-current={selected === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
