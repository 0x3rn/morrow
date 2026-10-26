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
  "border-border",
  "bg-card",
  "px-3.5",
  "py-2.5",
  "text-sm",
  "text-foreground",
  "outline-none",
  "transition-colors",
  "duration-150",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring",
  "focus-visible:ring-2",
  "focus-visible:ring-ring/15",
  "motion-reduce:transition-none",
].join(" ");

const buttonClasses = [
  "inline-flex",
  "min-h-10",
  "items-center",
  "justify-center",
  "rounded-xl",
  "border",
  "border-border",
  "bg-card",
  "px-3.5",
  "py-2",
  "text-sm",
  "font-medium",
  "text-foreground",
  "transition-colors",
  "duration-150",
  "hover:bg-muted",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-ring/25",
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
    return "border-destructive-border bg-destructive-bg text-destructive";
  }

  if (
    match.status ===
    "unmatched"
  ) {
    return "border-warning-border bg-warning-bg text-warning";
  }

  if (
    match.matchCount > 1
  ) {
    return "border-warning-border bg-warning-bg text-warning";
  }

  return "border-success-border bg-success-bg text-success";
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
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h5>

      <div className="mt-2 space-y-2">
        {matches.map(
          (match) => (
            <div
              key={
                match.selector
              }
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-xs font-medium text-foreground">
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
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
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
      className="mt-6 border-t border-border pt-5"
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
          <h4 className="text-sm font-semibold text-foreground">
            Monitoring scope
          </h4>

          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Choose whether Morrow
            monitors the whole page
            or scans the page so you
            can tick specific
            sections to monitor.
          </p>
        </div>

        <span className="workspace-scope-tag inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border bg-muted px-3.5 py-1 text-xs font-medium text-muted-foreground">
          {hasIncludeSelectors
            ? "Selected sections"
            : "Whole page"}
        </span>
      </div>

      {missingSelectedSelectors.length >
      0 ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-warning-border bg-warning-bg p-3.5"
        >
          <p className="text-xs font-semibold text-warning">
            Monitored section no
            longer found on page
          </p>
          <p className="mt-1 text-xs leading-5 text-warning">
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
              <div className="text-sm font-medium text-foreground">
                Monitor the whole
                page
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
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
              <div className="text-sm font-medium text-foreground">
                Scan page to select
                sections to monitor
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
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
        <div className="mt-4 rounded-xl border border-warning-border bg-warning-bg p-3.5">
          <p className="text-xs font-medium text-warning">
            Unable to scan page
            sections
          </p>
          <p className="mt-1 text-xs leading-5 text-warning">
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
            <label className="block text-xs font-medium text-muted-foreground">
              Sections to monitor
            </label>

            {availableSections.length >
            0 ? (
              <span className="text-xs text-muted-foreground">
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

          <div className="rounded-xl border border-border bg-card p-3.5">
            {availableSections.length ===
            0 ? (
              <div className="py-3 text-center">
                <p className="text-xs font-medium text-foreground">
                  {scopeMode ===
                  "whole_page"
                    ? "Whole page monitoring is active"
                    : "No sections scanned yet"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
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
                            <span className="text-sm font-medium text-foreground">
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
                            <code className="break-all text-xs text-muted-foreground">
                              {
                                section.selector
                              }
                            </code>
                          </div>

                          {section.preview ? (
                            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
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

          <p className="mt-2 text-xs leading-5 text-muted-foreground">
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
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
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

          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Changes inside these
            regions will be ignored,
            even when they are inside
            a monitored section.
          </p>
        </div>
        */}
      </div>

      {preview ? (
        <div className="mt-5 rounded-xl border border-border bg-muted p-4">
          {!preview.ok ? (
            <div>
              <p className="text-sm font-medium text-foreground">
                Unable to test
                selectors
              </p>

              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {toUserFacingErrorMessage(
                  preview.message,
                  "Morrow couldn't test these selectors.",
                )}
              </p>
            </div>
          ) : (
            <div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Selector test
                  results
                </p>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs font-medium text-foreground">
                      Whole page
                      monitoring
                    </p>

                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
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

      <div className="workspace-scope-footer mt-5 border-t border-border pt-4">
        <p className="text-xs leading-5 text-muted-foreground">
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

