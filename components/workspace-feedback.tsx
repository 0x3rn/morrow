"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toUserFacingErrorMessage } from "@/lib/user-facing-error";

const FeedbackContext = createContext<(message: string) => void>(() => {});

export function WorkspaceFeedback({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; id: number } | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  const [paused, setPaused] = useState(false);
  const sequence = useRef(0);
  const notify = useCallback((message: string) => {
    setPaused(false);
    setNotice({ message, id: ++sequence.current });
  }, []);

  useEffect(() => {
    if (!notice) return;
    // Keep feedback above an open modal and move it back when the modal closes
    // or its record disappears after a removal.
    const updateTarget = () => setTarget(document.querySelector(".workspace-panel[open], .workspace-switcher-dialog[open], .billing-plan-dialog[open]") || document.querySelector(".morrow-dashboard"));
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [notice]);

  useEffect(() => {
    if (!notice || paused) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice, paused]);

  return <FeedbackContext.Provider value={notify}>
    {children}
    {notice && target && createPortal(
      <div className="workspace-toast" key={notice.id}
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
        <div role="status" aria-live="polite" aria-atomic="true">{notice.message}</div>
        <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button>
      </div>, target
    )}
  </FeedbackContext.Provider>;
}

export const useWorkspaceFeedback = () => useContext(FeedbackContext);

export function WorkspaceActionForm({ action, successMessage, children, className }: {
  action: (data: FormData) => Promise<unknown>;
  successMessage: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const notify = useWorkspaceFeedback();
  const inFlight = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <form className={className} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    inFlight.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await action(data);
        if (
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof (result as { error?: unknown }).error === "string" &&
          (result as { error: string }).error.trim().length > 0
        ) {
          setError(toUserFacingErrorMessage((result as { error: string }).error));
          return;
        }
        if (
          typeof result === "object" &&
          result !== null &&
          "checkoutUrl" in result &&
          typeof (result as { checkoutUrl?: unknown }).checkoutUrl === "string" &&
          (result as { checkoutUrl: string }).checkoutUrl.startsWith("https://")
        ) {
          window.location.assign((result as { checkoutUrl: string }).checkoutUrl);
          return;
        }
        notify(successMessage);
        router.refresh();
      } catch (error) {
        setError(toUserFacingErrorMessage(error));
      } finally {
        inFlight.current = false;
      }
    });
  }}>
    <fieldset className="workspace-action-fields" disabled={pending}>{children}</fieldset>
    {pending && <p className="workspace-action-status" role="status">Please wait…</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </form>;
}
