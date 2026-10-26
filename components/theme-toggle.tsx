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
    const color = resolvedTheme === "dark" ? "#121212" : "#FFFFFF";
    const metaTags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metaTags.forEach((meta) => {
      if (!meta.media || window.matchMedia(meta.media).matches) {
        meta.content = color;
      }
    });
  }, [mounted, resolvedTheme]);

  if (!mounted) {
    return <div className="min-h-11 w-[168px]" aria-hidden />;
  }

  const options = ["light", "dark", "system"] as const;
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex min-h-11 items-center rounded-lg border border-border bg-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={theme === o}
          onClick={() => setTheme(o)}
          className={`min-h-9 rounded-md px-3 py-1.5 text-sm capitalize ${
            theme === o
              ? "border border-border bg-card text-foreground"
              : "border border-transparent text-muted-foreground"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
