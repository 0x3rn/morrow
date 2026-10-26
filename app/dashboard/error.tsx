"use client";

import Link from "next/link";
import { toUserFacingErrorMessage } from "@/lib/user-facing-error";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = toUserFacingErrorMessage(
    error,
    "We couldn't load this workspace view right now. Please try again.",
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="workspace-surface">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Workspace notice
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">
            Unable to complete this request
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground" role="alert">
            {message}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="workspace-primary"
            >
              Try again
            </button>
            <Link
              href="/dashboard"
              prefetch={false}
              className="workspace-panel-trigger workspace-panel-secondary"
            >
              Return to overview
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
