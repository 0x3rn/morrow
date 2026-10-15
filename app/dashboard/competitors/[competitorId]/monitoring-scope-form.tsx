"use client";

import { WorkspaceActionForm } from "@/components/workspace-feedback";
import type { DiscoveredMonitoringSection } from "@/lib/monitoring-selectors";
import { toUserFacingErrorMessage } from "@/lib/user-facing-error";

import {
  useState,
  useTransition,
} from "react";

import {
  previewMonitoredPageMonitoringScope,
  scanMonitoredPageSections,
  updateMonitoredPageMonitoringScope,
} from "./actions";

interface MonitoringScopeFormProps {
  monitoredPageId: string;
  competitorId: string;

  initialIncludeSelectors: string;

  initialIgnoreSelectors: string;

  initialMissingSelectors?: string[];
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

function parseInitialSelectorLines(
  value: string
) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) =>
          line.trim()
        )
        .filter(Boolean)
    ),
  ];
}

function buildInitialSectionItems(
  selectors: string[],
  missingSelectors: string[]
): DiscoveredMonitoringSection[] {
  const missingSet = new Set(
    missingSelectors
  );

  return selectors.map(
    (selector, index) => ({
      selector,
      label: selector.startsWith(
        "#"
      )
        ? selector
            .slice(1)
            .replace(
              /[_-]+/g,
              " "
            )
            .replace(
              /^\w/,
              (c) =>
                c.toUpperCase()
            )
        : `Monitored section ${
            index + 1
          }`,
      tagName: "section",
      status: missingSet.has(
        selector
      )
        ? "unmatched"
        : "matched",
      matchCount:
        missingSet.has(
          selector
        )
          ? 0
          : 1,
      preview: missingSet.has(
        selector
      )
        ? "This section was not found in the latest page capture. Scan the page again in case it was removed or renamed."
        : "Saved section selector. Click 'Scan page for sections to monitor' or 'Test selectors' to refresh.",
    })
  );
}

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
  match: Pick<
    SelectorMatch,
    "status" | "matchCount"
  >
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
    return "Removed / no match";
  }

  if (
    match.matchCount === 1
  ) {
    return "1 match";
  }

  return `${match.matchCount} matches`;
}

function getMatchClasses(
  match: Pick<
    SelectorMatch,
    "status" | "matchCount"
  >
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
                  className={`inline-flex w-fit shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getMatchClasses(
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
  initialMissingSelectors = [],
}: MonitoringScopeFormProps) {
  const initialSelectedList =
    parseInitialSelectorLines(
      initialIncludeSelectors
    );

  const [
    scopeMode,
    setScopeMode,
  ] = useState<
    | "whole_page"
    | "selected_sections"
  >(
    initialSelectedList.length >
      0
      ? "selected_sections"
      : "whole_page"
  );

  const [
    selectedSelectors,
    setSelectedSelectors,
  ] = useState<string[]>(
    initialSelectedList
  );

  const [
    availableSections,
    setAvailableSections,
  ] = useState<
    DiscoveredMonitoringSection[]
  >(() =>
    buildInitialSectionItems(
      initialSelectedList,
      initialMissingSelectors
    )
  );

  const [
    scanState,
    setScanState,
  ] = useState<{
    ok: boolean;
    message: string | null;
    capturedAt: string | null;
  } | null>(null);

  const [
    ignoreSelectors,
    setIgnoreSelectors,
  ] = useState(
    initialIgnoreSelectors
  );

  const [
    preview,
    setPreview,
  ] = useState<
    PreviewResult | null
  >(null);

  const [
    isScanPending,
    startScanTransition,
  ] = useTransition();

  const [
    isPreviewPending,
    startPreviewTransition,
  ] = useTransition();

  const effectiveIncludeSelectorsValue =
    scopeMode ===
    "selected_sections"
      ? selectedSelectors.join(
          "\n"
        )
      : "";

  const hasIncludeSelectors =
    scopeMode ===
      "selected_sections" &&
    selectedSelectors.length >
      0;

  const missingSelectedSelectors =
    availableSections
      .filter(
        (section) =>
          selectedSelectors.includes(
            section.selector
          ) &&
          (section.status ===
            "unmatched" ||
            section.status ===
              "invalid")
      )
      .map(
        (section) =>
          section.selector
      );

  function toggleSectionSelector(
    selector: string
  ) {
    setScopeMode(
      "selected_sections"
    );
    setPreview(null);

    setSelectedSelectors(
      (previous) =>
        previous.includes(
          selector
        )
          ? previous.filter(
              (item) =>
                item !==
                selector
            )
          : [
              ...previous,
              selector,
            ]
    );
  }

  function handleScanPageSections() {
    setScopeMode(
      "selected_sections"
    );
    setPreview(null);

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
      selectedSelectors.join(
        "\n"
      )
    );

    startScanTransition(
      async () => {
        try {
          const result =
            await scanMonitoredPageSections(
              formData
            );

          if (!result.ok) {
            setScanState({
              ok: false,
              message:
                result.message,
              capturedAt:
                result.capturedAt,
            });
            return;
          }

          setAvailableSections(
            result.sections
          );

          setScanState({
            ok: true,
            message: null,
            capturedAt:
              result.capturedAt,
          });
        } catch {
          setScanState({
            ok: false,
            message:
              "Morrow couldn't scan this page for sections.",
            capturedAt: null,
          });
        }
      }
    );
  }

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
      effectiveIncludeSelectorsValue
    );

    formData.set(
      "ignoreSelectors",
      ""
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

          if (
            result.ok &&
            result
              .includeMatches
              .length > 0
          ) {
            const matchBySelector =
              new Map(
                result.includeMatches.map(
                  (match) => [
                    match.selector,
                    match,
                  ]
                )
              );

            setAvailableSections(
              (previous) =>
                previous.map(
                  (section) => {
                    const updated =
                      matchBySelector.get(
                        section.selector
                      );
                    if (
                      !updated
                    ) {
                      return section;
                    }
                    return {
                      ...section,
                      status:
                        updated.status,
                      matchCount:
                        updated.matchCount,
                      preview:
                        updated.preview ||
                        section.preview,
                    };
                  }
                )
            );
          }
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

  return (
    <WorkspaceActionForm
      successMessage="Monitoring scope saved."
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

      <input
        type="hidden"
        name="includeSelectors"
        value={
          effectiveIncludeSelectorsValue
        }
      />

      <input
        type="hidden"
        name="ignoreSelectors"
        value=""
      />

      <div className="workspace-scope-header flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">
            Monitoring scope
          </h4>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            Choose whether Morrow
            monitors the whole page
            or scans the page so you
            can tick specific
            sections to monitor.
          </p>
        </div>

        <span className="workspace-scope-tag inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-medium text-slate-600">
          {hasIncludeSelectors
            ? "Selected sections"
            : "Whole page"}
        </span>
      </div>

      {missingSelectedSelectors.length >
      0 ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5"
        >
          <p className="text-xs font-semibold text-amber-800">
            Monitored section no
            longer found on page
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            {missingSelectedSelectors.length ===
            1
              ? `The monitored section (${missingSelectedSelectors[0]}) appears to have been removed or renamed.`
              : `${missingSelectedSelectors.length} monitored sections (${missingSelectedSelectors.join(", ")}) appear to have been removed or renamed.`}{" "}
            Click{" "}
            <strong>
              Scan page for sections
              to monitor
            </strong>{" "}
            below to refresh the
            page&apos;s sections and
            update your selection.
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <div
          className="workspace-choice-grid"
          role="radiogroup"
          aria-label="Monitoring scope mode"
        >
          <label className="workspace-choice-option">
            <input
              type="radio"
              name={`scope-mode-${monitoredPageId}`}
              checked={
                scopeMode ===
                "whole_page"
              }
              onChange={() => {
                setScopeMode(
                  "whole_page"
                );
                setPreview(
                  null
                );
              }}
            />
            <div>
              <div className="text-sm font-medium text-slate-900">
                Monitor the whole
                page
              </div>
              <div className="mt-0.5 text-xs leading-5 text-slate-500">
                Compare all readable
                content across the
                entire page.
              </div>
            </div>
          </label>

          <label className="workspace-choice-option">
            <input
              type="radio"
              name={`scope-mode-${monitoredPageId}`}
              checked={
                scopeMode ===
                "selected_sections"
              }
              onChange={() => {
                setScopeMode(
                  "selected_sections"
                );
                setPreview(
                  null
                );
              }}
            />
            <div>
              <div className="text-sm font-medium text-slate-900">
                Scan page to select
                sections to monitor
              </div>
              <div className="mt-0.5 text-xs leading-5 text-slate-500">
                Tick which page
                sections to monitor;
                unticked sections
                are ignored.
              </div>
            </div>
          </label>
        </div>

        <div>
          <button
            type="button"
            onClick={
              handleScanPageSections
            }
            disabled={
              isScanPending
            }
            className={
              buttonClasses
            }
          >
            {isScanPending
              ? "Scanning page for sections…"
              : "Scan page for sections to monitor"}
          </button>
        </div>
      </div>

      {scanState &&
      !scanState.ok ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <p className="text-xs font-medium text-amber-800">
            Unable to scan page
            sections
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            {toUserFacingErrorMessage(
              scanState.message,
              "Morrow couldn't scan this page for sections."
            )}
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-600">
              Sections to monitor
            </label>

            {availableSections.length >
            0 ? (
              <span className="text-xs text-slate-500">
                {
                  selectedSelectors.length
                }{" "}
                of{" "}
                {
                  availableSections.length
                }{" "}
                ticked
              </span>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            {availableSections.length ===
            0 ? (
              <div className="py-3 text-center">
                <p className="text-xs font-medium text-slate-700">
                  {scopeMode ===
                  "whole_page"
                    ? "Whole page monitoring is active"
                    : "No sections scanned yet"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Click{" "}
                  <strong>
                    Scan page for
                    sections to
                    monitor
                  </strong>{" "}
                  above to list the
                  sections found on
                  this page so you
                  can tick which ones
                  to monitor.
                </p>
              </div>
            ) : (
              <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
                {scanState?.ok &&
                scanState.capturedAt ? (
                  <p className="text-xs text-slate-500">
                    Scanned from
                    capture on{" "}
                    {formatCapturedAt(
                      scanState.capturedAt
                    )}
                    .
                  </p>
                ) : null}

                {availableSections.map(
                  (section) => {
                    const isChecked =
                      scopeMode ===
                        "selected_sections" &&
                      selectedSelectors.includes(
                        section.selector
                      );

                    return (
                      <label
                        key={
                          section.selector
                        }
                        className="workspace-choice-option w-full"
                      >
                        <input
                          type="checkbox"
                          checked={
                            isChecked
                          }
                          onChange={() =>
                            toggleSectionSelector(
                              section.selector
                            )
                          }
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {
                                section.label
                              }
                            </span>

                            <span
                              className={`inline-flex w-fit shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getMatchClasses(
                                section
                              )}`}
                            >
                              {getMatchLabel(
                                section
                              )}
                            </span>
                          </div>

                          <div className="mt-1">
                            <code className="break-all text-xs text-slate-600">
                              {
                                section.selector
                              }
                            </code>
                          </div>

                          {section.preview ? (
                            <p className="mt-1.5 text-xs leading-5 text-slate-500">
                              {
                                section.preview
                              }
                            </p>
                          ) : null}
                        </div>
                      </label>
                    );
                  }
                )}
              </div>
            )}
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-400">
            Tick the sections you
            want Morrow to monitor.
            Unticked sections are
            automatically ignored.
          </p>
        </div>

        {/*
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
        */}
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
                {toUserFacingErrorMessage(
                  preview.message,
                  "Morrow couldn't test these selectors.",
                )}
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
                      No section selectors are ticked,
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

                {/*
                <SelectorResultList
                  title="Regions to ignore"
                  matches={
                    preview
                      .ignoreMatches
                  }
                />
                */}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="workspace-scope-footer mt-5 border-t border-slate-100 pt-4">
        <p className="text-xs leading-5 text-slate-400">
          Test your selected sections
          against the latest capture
          to verify they are still
          available before saving.
        </p>

        <div className="workspace-scope-actions">
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
            className="workspace-primary"
          >
            Save monitoring scope
          </button>
        </div>
      </div>
    </WorkspaceActionForm>
  );
}

