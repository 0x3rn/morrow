"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/competitors", label: "Competitors" },
  { href: "/dashboard/changes", label: "Change history" },
];

export function WorkspaceNav() {
  const pathname = usePathname();
  const selected = pathname.startsWith("/dashboard/changes")
    ? "/dashboard/changes"
    : pathname.startsWith("/dashboard/competitors") || pathname.startsWith("/dashboard/pages")
      ? "/dashboard/competitors"
      : "/dashboard";

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {destinations.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={selected === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
