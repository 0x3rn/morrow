"use client";

import { useId, useRef, type ReactNode } from "react";

export function WorkspacePanel({ label, title = label, children }: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button className={`workspace-panel-trigger${label === "Manage" ? " workspace-panel-secondary" : ""}`} type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} className="workspace-panel" aria-labelledby={titleId}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="workspace-panel-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="workspace-panel-close" type="button" aria-label={`Close ${title}`}
            onClick={() => dialog.current?.close()}>×</button>
        </div>
        <div className="workspace-panel-body">{children}</div>
      </dialog>
    </>
  );
}
