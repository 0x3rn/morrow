"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    if (!mounted) return;
    // Intentional exception: update browser chrome <meta name="theme-color"> to match active theme
    const color = resolvedTheme === "dark" ? "#0A0A0A" : "#FFFFFF";
    const metaTags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metaTags.forEach((meta) => {
      if (!meta.media || window.matchMedia(meta.media).matches) {
        meta.content = color;
      }
    });
  }, [mounted, resolvedTheme]);

  if (!mounted) {
    return <div className="min-h-11 w-[156px]" aria-hidden />;
  }

  const options = ["light", "dark", "system"] as const;
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-border bg-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={theme === o}
          onClick={() => setTheme(o)}
          // The ::after extends the 36px segment to a 44px touch target without growing the control.
          className={`relative inline-flex min-h-9 flex-1 items-center justify-center whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 py-1 text-[13px] font-medium leading-5 capitalize transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
            theme === o
              ? "border border-border bg-card text-foreground"
              : "border border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
