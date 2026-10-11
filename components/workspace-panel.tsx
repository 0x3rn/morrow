"use client";

import { useId, useRef, type ReactNode } from "react";

export function WorkspacePanel({ label, title = label, children }: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  return (
    <>
      <button className={`workspace-panel-trigger${label === "Manage" ? " workspace-panel-secondary" : ""}`} type="button" aria-haspopup="dialog" onClick={(event) => {
        dialog.current?.showModal();
        if (event.detail > 0) heading.current?.focus({ preventScroll: true });
        else closeButton.current?.focus({ preventScroll: true });
      }}>
        {label}
      </button>
      <dialog ref={dialog} className="workspace-panel" aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="workspace-panel-heading">
          <h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2>
          <button ref={closeButton} className="workspace-panel-close" type="button" aria-label={`Close ${title}`}
            onClick={() => dialog.current?.close()}>×</button>
        </div>
        <div className="workspace-panel-body">{children}</div>
      </dialog>
    </>
  );
}
