"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import styles from "@/app/page.module.css";
import { ThemeToggle } from "@/components/theme-toggle";

interface MobileMenuProps {
  navigation: ReadonlyArray<{ href: string; label: string }>;
}

// Must match the breakpoint where the desktop navigation takes over in page.module.css.
const DESKTOP_QUERY = "(min-width: 1024px)";

export function MobileMenu({ navigation }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      buttonRef.current?.focus();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    // Resizing or rotating to the desktop layout hides the menu, so release the scroll lock.
    const query = window.matchMedia(DESKTOP_QUERY);
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setIsOpen(false);
    }
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className={styles.mobileMenu}>
      <button ref={buttonRef} aria-controls={menuId} aria-expanded={isOpen} className={styles.menuButton} onClick={() => setIsOpen((open) => !open)} type="button">
        <span>{isOpen ? "Close" : "Menu"}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          {isOpen ? <path d="m5 5 10 10M15 5 5 15" /> : <path d="M3.5 6.5h13M3.5 13.5h13" />}
        </svg>
      </button>
      <div className={styles.mobileDrawer} hidden={!isOpen} id={menuId}>
        <nav aria-label="Mobile navigation">
          {navigation.map((item) => (
            <a href={item.href} key={item.href} onClick={() => setIsOpen(false)}>{item.label}</a>
          ))}
        </nav>
        <div className={styles.mobileAccount}>
          <div className={styles.mobileThemeRow}>
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <div className={styles.mobileDivider} />
          <Link href="/login" onClick={() => setIsOpen(false)}>Log in</Link>
          <Link className={styles.mobileCta} href="/register" onClick={() => setIsOpen(false)}>Start monitoring</Link>
        </div>
      </div>
    </div>
  );
}
