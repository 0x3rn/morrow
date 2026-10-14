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
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-12 text-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
          Morrow
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-slate-950">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" role="alert">
          {message}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
