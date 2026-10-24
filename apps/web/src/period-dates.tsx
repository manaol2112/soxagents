"use client";

import { type ReactNode, useRef, useState } from "react";
import { OptionalMark, RequiredMark } from "./field-marks";
import { periodStartFor } from "./onboarding-model";

/** Period start and end. An empty start fills from the end: the twelve months
 * that close on that date. A start someone typed is left as it is. */
export function PeriodDates({
  start,
  end,
  disabled,
  endHint,
  marked = false,
}: {
  start: string | null;
  end: string | null;
  disabled: boolean;
  endHint?: ReactNode;
  /** Says which date the launch needs: the end; the start defaults from it. */
  marked?: boolean;
}) {
  const suggested = end !== null && end !== "" ? periodStartFor(end) : null;
  const [endValue, setEndValue] = useState(end ?? "");
  const [startValue, setStartValue] = useState(
    start !== null && start !== "" ? start : (suggested ?? ""),
  );
  const follows = useRef(start === null || start === "" || start === suggested);

  function changeEnd(value: string) {
    setEndValue(value);
    if (follows.current) {
      setStartValue(periodStartFor(value) ?? "");
    }
  }

  function changeStart(value: string) {
    setStartValue(value);
    follows.current = value === "" || value === periodStartFor(endValue);
  }

  const suggestedNow = periodStartFor(endValue);
  const showHint =
    !disabled &&
    startValue !== "" &&
    startValue === suggestedNow &&
    startValue !== (start ?? "");

  return (
    <>
      <label htmlFor="profile-period-start">
        <span>
          Period start
          {marked ? <OptionalMark /> : null}
        </span>
        <input
          id="profile-period-start"
          name="period_start"
          type="date"
          value={disabled ? (start ?? "") : startValue}
          disabled={disabled}
          onChange={(event) => changeStart(event.target.value)}
        />
        {showHint ? (
          <span className="form-hint">
            The twelve months ending on the period end. Change it for a short or
            transition period.
          </span>
        ) : null}
      </label>
      <label htmlFor="profile-period">
        <span>
          Period end
          {marked ? <RequiredMark /> : null}
        </span>
        <input
          id="profile-period"
          name="period_end"
          type="date"
          value={disabled ? (end ?? "") : endValue}
          disabled={disabled}
          onChange={(event) => changeEnd(event.target.value)}
        />
        {endHint}
      </label>
    </>
  );
}
