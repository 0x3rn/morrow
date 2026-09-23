"use client";

import {
  useState,
  useTransition,
} from "react";

import {
  previewMonitoredPageMonitoringScope,
  updateMonitoredPageMonitoringScope,
} from "./actions";

interface MonitoringScopeFormProps {
  monitoredPageId: string;
  competitorId: string;

  initialIncludeSelectors:
    string;

  initialIgnoreSelectors:
    string;
}

type PreviewResult =
  Awaited<
    ReturnType<
      typeof previewMonitoredPageMonitoringScope
    >
  >;

type SelectorMatch =
  PreviewResult[
    "includeMatches"
  ][number];

const inputClasses = [
  "w-full",
  "rounded-xl",
  "border",
  "border-slate-200",
  "bg-white",
  "px-3.5",
  "py-2.5",
  "text-sm",
  "text-slate-950",
  "outline-none",
  "transition-colors",
  "duration-150",
  "placeholder:text-slate-400",
  "focus-visible:border-indigo-400",
  "focus-visible:ring-2",
  "focus-visible:ring-indigo-500/15",
  "motion-reduce:transition-none",
].join(" ");

const buttonClasses = [
  "inline-flex",
  "min-h-10",
  "items-center",
  "justify-center",
  "rounded-xl",
  "border",
  "border-slate-200",
  "bg-white",
  "px-3.5",
  "py-2",
  "text-sm",
  "font-medium",
  "text-slate-700",
  "transition-colors",
  "duration-150",
  "hover:border-slate-300",
  "hover:bg-slate-50",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-indigo-500/25",
  "disabled:cursor-not-allowed",
  "disabled:opacity-60",
  "motion-reduce:transition-none",
].join(" ");

function normalizeTimestamp(
  value: string
) {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(
      value
    )
  ) {
    return value;
  }

  return `${
    value.replace(
      " ",
      "T"
    )
  }Z`;
}

function formatCapturedAt(
  value: string | null
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(
      normalizeTimestamp(
        value
      )
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return `${new Intl.DateTimeFormat(
    "en-GB",
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",

      timeZone:
        "UTC",
    }
  ).format(date)} UTC`;
}

function getMatchLabel(
  match: SelectorMatch
) {
  if (
    match.status ===
    "invalid"
  ) {
    return "Invalid selector";
  }

  if (
    match.status ===
    "unmatched"
  ) {
    return "No matches";
  }

  if (
    match.matchCount === 1
  ) {
    return "1 match";
  }

  return `${match.matchCount} matches`;
}

function getMatchClasses(
  match: SelectorMatch
) {
  if (
    match.status ===
    "invalid"
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (
    match.status ===
    "unmatched"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (
    match.matchCount > 1
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function SelectorResultList({
  title,
  matches,
}: {
  title: string;
  matches:
    SelectorMatch[];
}) {
  if (
    matches.length === 0
  ) {
    return null;
  }

  return (
    <div>
      <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h5>

      <div className="mt-2 space-y-2">
        {matches.map(
          (match) => (
            <div
              key={
                match.selector
              }
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-xs font-medium text-slate-800">
                  {
                    match.selector
                  }
                </code>

                <span
                  className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${getMatchClasses(
                    match
                  )}`}
                >
                  {getMatchLabel(
                    match
                  )}
                </span>
              </div>

              {match.preview ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {
                    match.preview
                  }
                </p>
              ) : null}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function MonitoringScopeForm({
  monitoredPageId,
  competitorId,
  initialIncludeSelectors,
  initialIgnoreSelectors,
}: MonitoringScopeFormProps) {
  const [
    includeSelectors,
    setIncludeSelectors,
  ] =
    useState(
      initialIncludeSelectors
    );

  const [
    ignoreSelectors,
    setIgnoreSelectors,
  ] =
    useState(
      initialIgnoreSelectors
    );

  const [
    preview,
    setPreview,
  ] =
    useState<
      PreviewResult | null
    >(null);

  const [
    isPreviewPending,
    startPreviewTransition,
  ] =
    useTransition();

  function testSelectors() {
    const formData =
      new FormData();

    formData.set(
      "monitoredPageId",
      monitoredPageId
    );

    formData.set(
      "competitorId",
      competitorId
    );

    formData.set(
      "includeSelectors",
      includeSelectors
    );

    formData.set(
      "ignoreSelectors",
      ignoreSelectors
    );

    startPreviewTransition(
      async () => {
        try {
          const result =
            await previewMonitoredPageMonitoringScope(
              formData
            );

          setPreview(
            result
          );
        } catch {
          setPreview({
            ok: false,
            message:
              "Morrow couldn't test these selectors.",
            capturedAt:
              null,
            includeMatches:
              [],
            ignoreMatches:
              [],
          });
        }
      }
    );
  }

  const hasIncludeSelectors =
    includeSelectors
      .trim()
      .length > 0;

  return (
    <form
      action={
        updateMonitoredPageMonitoringScope
      }
      className="mt-6 border-t border-slate-200 pt-5"
    >
      <input
        type="hidden"
        name="monitoredPageId"
        value={
          monitoredPageId
        }
      />

      <input
        type="hidden"
        name="competitorId"
        value={
          competitorId
        }
      />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Monitoring scope
          </h4>

          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Choose which parts of this page
            Morrow should compare and which
            parts to ignore.
          </p>
        </div>

        <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
          {hasIncludeSelectors
            ? "Selected sections"
            : "Whole page"}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <label
            htmlFor={`include-selectors-${monitoredPageId}`}
            className="mb-1.5 block text-xs font-medium text-slate-600"
          >
            Sections to monitor
          </label>

          <textarea
            id={`include-selectors-${monitoredPageId}`}
            name="includeSelectors"
            value={
              includeSelectors
            }
            onChange={(
              event
            ) => {
              setIncludeSelectors(
                event.target
                  .value
              );

              setPreview(
                null
              );
            }}
            placeholder={[
              ".pricing",
              "#features",
              "[data-section='plans']",
            ].join("\n")}
            rows={6}
            className={`${inputClasses} resize-y font-mono text-xs leading-5`}
          />

          <p className="mt-2 text-xs leading-5 text-slate-400">
            One CSS selector per
            line. Leave this empty
            to monitor the entire
            page.
          </p>
        </div>

        <div>
          <label
            htmlFor={`ignore-selectors-${monitoredPageId}`}
            className="mb-1.5 block text-xs font-medium text-slate-600"
          >
            Regions to ignore
          </label>

          <textarea
            id={`ignore-selectors-${monitoredPageId}`}
            name="ignoreSelectors"
            value={
              ignoreSelectors
            }
            onChange={(
              event
            ) => {
              setIgnoreSelectors(
                event.target
                  .value
              );

              setPreview(
                null
              );
            }}
            placeholder={[
              ".live-counter",
              ".rotating-reviews",
              "[data-dynamic]",
            ].join("\n")}
            rows={6}
            className={`${inputClasses} resize-y font-mono text-xs leading-5`}
          />

          <p className="mt-2 text-xs leading-5 text-slate-400">
            Changes inside these
            regions will be ignored,
            even when they are inside
            a monitored section.
          </p>
        </div>
      </div>

      {preview ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {!preview.ok ? (
            <div>
              <p className="text-sm font-medium text-slate-900">
                Unable to test
                selectors
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                {
                  preview.message
                }
              </p>
            </div>
          ) : (
            <div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Selector test
                  results
                </p>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Using the latest
                  captured version
                  {preview.capturedAt
                    ? ` from ${formatCapturedAt(
                        preview.capturedAt
                      )}`
                    : ""}
                  .
                </p>
              </div>

              <div className="mt-4 space-y-5">
                {preview
                  .includeMatches
                  .length ===
                0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-medium text-slate-700">
                      Whole page
                      monitoring
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      No section selectors are set,
                      so Morrow will compare the whole
                      page.
                    </p>
                  </div>
                ) : (
                  <SelectorResultList
                    title="Sections to monitor"
                    matches={
                      preview
                        .includeMatches
                    }
                  />
                )}

                <SelectorResultList
                  title="Regions to ignore"
                  matches={
                    preview
                      .ignoreMatches
                  }
                />
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-400">
          Test these selectors
          against the latest capture
          before saving. Up to 20
          selectors per list.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={
              testSelectors
            }
            disabled={
              isPreviewPending
            }
            className={
              buttonClasses
            }
          >
            {isPreviewPending
              ? "Testing…"
              : "Test selectors"}
          </button>

          <button
            type="submit"
            className={
              buttonClasses
            }
          >
            Save monitoring scope
          </button>
        </div>
      </div>
    </form>
  );
}