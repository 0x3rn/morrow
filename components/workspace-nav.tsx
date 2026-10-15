"use client";

import { useEffect, useRef, type ReactNode } from "react";
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

export function WorkspaceAccountMenu({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const details = detailsRef.current;
    if (details) {
      details.open = false;
    }
  }, [pathname]);

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent | TouchEvent) {
      const details = detailsRef.current;
      if (!details || !details.open) return;
      if (details.querySelector("dialog[open]")) return;

      const target = event.target;
      if (target instanceof Node && !details.contains(target)) {
        details.open = false;
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const details = detailsRef.current;
      if (!details || !details.open) return;
      if (details.querySelector("dialog[open]")) return;
      details.open = false;
    }

    function handleDialogClose(event: Event) {
      const details = detailsRef.current;
      if (!details || !details.open) return;
      if (
        event.target instanceof HTMLDialogElement &&
        window.matchMedia("(max-width: 767px)").matches
      ) {
        details.open = false;
      }
    }

    const details = detailsRef.current;
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    document.addEventListener("touchstart", handleOutsidePointer, true);
    document.addEventListener("keydown", handleKeyDown);
    details?.addEventListener("close", handleDialogClose, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
      document.removeEventListener("touchstart", handleOutsidePointer, true);
      document.removeEventListener("keydown", handleKeyDown);
      details?.removeEventListener("close", handleDialogClose, true);
    };
  }, []);

  return (
    <details ref={detailsRef} className="workspace-account">
      {children}
    </details>
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
