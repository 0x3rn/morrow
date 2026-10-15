"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/competitors", label: "Competitors" },
  { href: "/dashboard/changes", label: "Change history", mobileLabel: "Changes" },
  { href: "/dashboard/notifications", label: "Notifications" },
  { href: "/dashboard/team", label: "Team", mobileAccountOnly: true },
  { href: "/dashboard/billing", label: "Billing", mobileAccountOnly: true },
];

function resolveSelectedDestination(pathname: string) {
  return pathname.startsWith("/dashboard/billing")
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
}

export function WorkspaceNav() {
  const pathname = usePathname();
  const selected = resolveSelectedDestination(pathname);

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {destinations.map(({ href, label, mobileLabel, mobileAccountOnly }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          className={mobileAccountOnly ? "workspace-nav-desktop-only" : undefined}
          aria-current={selected === href ? "page" : undefined}
        >
          {mobileLabel ? (
            <>
              <span className="workspace-nav-label-desktop">{label}</span>
              <span className="workspace-nav-label-mobile">{mobileLabel}</span>
            </>
          ) : (
            label
          )}
        </Link>
      ))}
    </nav>
  );
}

export function WorkspaceAccountMobileLinks() {
  const pathname = usePathname();
  const selected = resolveSelectedDestination(pathname);
  const mobileAccountDestinations = destinations.filter((item) => item.mobileAccountOnly);

  return (
    <div className="workspace-account-mobile-links">
      {mobileAccountDestinations.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          className="workspace-panel-trigger workspace-panel-secondary"
          aria-current={selected === href ? "page" : undefined}
          onClick={(event) => {
            const details = event.currentTarget.closest("details");
            if (details) {
              details.open = false;
            }
          }}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
