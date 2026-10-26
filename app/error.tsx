"use client";

import Link from "next/link";
import { toUserFacingErrorMessage } from "@/lib/user-facing-error";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = toUserFacingErrorMessage(
    error,
    "We ran into an unexpected issue loading this page. Please try again.",
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Morrow
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" role="alert">
          {message}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover active:bg-primary-active"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-input bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
