"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { setupProblem } from "./onboarding-model";

/**
 * A setup form that saves in the background. The pressed button shows that it is working
 * while the page's data refreshes in place; the page does not reload or move. Without
 * scripts it posts and redirects like any other setup form.
 */
export function SetupForm({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const button = submitter instanceof HTMLButtonElement ? submitter : null;
    const data = new FormData(event.currentTarget, button);
    setPressed(button?.value || "submit");
    setProblem(null);
    startTransition(async () => {
      let notice = "";
      try {
        const response = await fetch("/workspace/setup", {
          method: "POST",
          body: data,
          headers: { "x-setup-fetch": "1" },
        });
        const body = (await response.json()) as { notice?: unknown };
        notice = typeof body.notice === "string" ? body.notice : "";
      } catch {
        notice = "";
      }
      const message = setupProblem(notice);
      if (message !== null) {
        setProblem(message);
      }
      // A leftover anchor in the address would pull the page back to it on refresh.
      if (window.location.hash !== "") {
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(window.history.state, "", url);
      }
      router.refresh();
    });
  }

  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/setup"
      className={className}
      onSubmit={submit}
      aria-busy={pending}
      data-pending={pending ? pressed : undefined}
    >
      <fieldset className="setup-form-fields" disabled={pending}>
        {children}
      </fieldset>
      {problem !== null ? (
        <p className="setup-form-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
