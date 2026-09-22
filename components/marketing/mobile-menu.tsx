"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import styles from "@/app/page.module.css";

interface MobileMenuProps {
  navigation: ReadonlyArray<{ href: string; label: string }>;
}

export function MobileMenu({ navigation }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <div className={styles.mobileMenu}>
      <button aria-controls={menuId} aria-expanded={isOpen} className={styles.menuButton} onClick={() => setIsOpen((open) => !open)} type="button">
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
          <div className={styles.mobileDivider} />
          <Link href="/login" onClick={() => setIsOpen(false)}>Log in</Link>
          <Link className={styles.mobileCta} href="/register" onClick={() => setIsOpen(false)}>Start monitoring</Link>
        </div>
      </div>
    </div>
  );
}
