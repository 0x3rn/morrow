"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const DIGEST_SCHEDULE_REQUIRED_MESSAGE =
  "Select at least one digest schedule (Daily, Weekly, or Monthly) to enable scheduled digest emails.";

export type EmailDigestPeriodOption = {
  period: string;
  label: string;
  allowed: boolean;
  lockedSuffix: string;
};

export function EmailDigestFields({
  initialEmailEnabled,
  initialDigestEnabled,
  initialDigestPeriods,
  scheduledDigestsAvailable,
  periodOptions,
}: {
  initialEmailEnabled: boolean;
  initialDigestEnabled: boolean;
  initialDigestPeriods: readonly string[];
  scheduledDigestsAvailable: boolean;
  periodOptions: readonly EmailDigestPeriodOption[];
}) {
  const [digestEnabled, setDigestEnabled] = useState(
    initialDigestEnabled && scheduledDigestsAvailable,
  );
  const [selectedPeriods, setSelectedPeriods] = useState(
    () =>
      new Set(
        initialDigestPeriods.filter((period) =>
          periodOptions.some(
            (option) => option.period === period && option.allowed,
          ),
        ),
      ),
  );
  const [showScheduleError, setShowScheduleError] = useState(false);
  const firstPeriodInputRef = useRef<HTMLInputElement>(null);

  const firstAllowedPeriod = periodOptions.find(
    (option) => option.allowed,
  )?.period;
  const isScheduleMissing =
    digestEnabled && selectedPeriods.size === 0;

  // Native constraint validation blocks the form submit (and shows the
  // browser tooltip) while digests are on but no schedule is selected.
  useEffect(() => {
    firstPeriodInputRef.current?.setCustomValidity(
      isScheduleMissing ? DIGEST_SCHEDULE_REQUIRED_MESSAGE : "",
    );
    if (!isScheduleMissing) {
      setShowScheduleError(false);
    }
  }, [isScheduleMissing]);

  function togglePeriod(period: string, checked: boolean) {
    setSelectedPeriods((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(period);
      } else {
        next.delete(period);
      }
      return next;
    });
  }

  return (
    <>
      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">
          Email delivery triggers
        </div>
        <div className="workspace-choice-grid">
          <label className="workspace-choice-option">
            <input
              type="checkbox"
              name="emailEnabled"
              value="1"
              defaultChecked={initialEmailEnabled}
            />
            <span>
              <strong className="block text-sm font-medium text-slate-900">
                Instant change alert emails
              </strong>
              <span className="block text-xs text-slate-500">
                Email me immediately when a monitored page records a change that matches my filters
              </span>
            </span>
          </label>

          <label className="workspace-choice-option">
            <input
              type="checkbox"
              name="digestEmailEnabled"
              value="1"
              checked={digestEnabled}
              onChange={(event) =>
                setDigestEnabled(event.target.checked)
              }
              disabled={!scheduledDigestsAvailable}
            />
            <span>
              <strong className="block text-sm font-medium text-slate-900">
                Scheduled digest emails
              </strong>
              <span className="block text-xs text-slate-500">
                {scheduledDigestsAvailable
                  ? "Email me a curated rollup when a scheduled digest includes matching changes"
                  : "Scheduled digests require Personal plan or higher"}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">
          Digest email schedules
        </div>
        <div className="workspace-choice-grid">
          {periodOptions.map((option) => {
            const isChecked =
              option.allowed && selectedPeriods.has(option.period);
            const isDisabled = !option.allowed || !digestEnabled;

            return (
              <label
                key={option.period}
                className={`workspace-choice-option${
                  isDisabled ? " opacity-60" : ""
                }`}
              >
                <input
                  ref={
                    option.period === firstAllowedPeriod
                      ? firstPeriodInputRef
                      : undefined
                  }
                  type="checkbox"
                  name="digestPeriods"
                  value={option.period}
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={(event) =>
                    togglePeriod(option.period, event.target.checked)
                  }
                  onInvalid={() => setShowScheduleError(true)}
                />
                <span className="text-sm font-medium text-slate-900">
                  {option.label}
                  {!option.allowed ? option.lockedSuffix : ""}
                </span>
              </label>
            );
          })}
        </div>

        {/* Disabled inputs are not submitted, so keep the saved schedule
            while digests are switched off. */}
        {!digestEnabled
          ? [...selectedPeriods].map((period) => (
              <input
                key={period}
                type="hidden"
                name="digestPeriods"
                value={period}
              />
            ))
          : null}

        {showScheduleError && isScheduleMissing ? (
          <p className="mt-2 text-xs font-medium text-rose-600" role="alert">
            {DIGEST_SCHEDULE_REQUIRED_MESSAGE}
          </p>
        ) : scheduledDigestsAvailable && !digestEnabled ? (
          <p className="mt-2 text-xs text-slate-500">
            Turn on scheduled digest emails to choose a schedule.
          </p>
        ) : null}

        {!scheduledDigestsAvailable ? (
          <p className="mt-2 text-xs text-slate-500">
            <Link
              href="/dashboard/billing"
              className="font-medium text-indigo-600"
            >
              Upgrade in Billing
            </Link>{" "}
            to enable scheduled digest rollups.
          </p>
        ) : null}
      </div>
    </>
  );
}
