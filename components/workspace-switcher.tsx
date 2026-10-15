"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { switchWorkspaceAction } from "@/app/dashboard/team/actions";
import { toUserFacingErrorMessage } from "@/lib/user-facing-error";
import { WORKSPACE_ROLE_DETAILS, type WorkspaceRole } from "@/lib/workspace-roles";
import { useWorkspaceFeedback } from "./workspace-feedback";

export interface SwitchableWorkspaceItem {
  id: string;
  name: string;
  role: WorkspaceRole;
  isActive: boolean;
  memberCount: number;
  competitorCount: number;
}

function getRoleBadgeClassName(role: WorkspaceRole): string {
  switch (role) {
    case "owner":
      return "workspace-badge health-healthy";
    case "admin":
      return "workspace-badge significance-moderate";
    case "member":
      return "workspace-badge";
    case "viewer":
      return "workspace-badge health-paused";
  }
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: SwitchableWorkspaceItem[];
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const notify = useWorkspaceFeedback();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<string>(activeWorkspaceId);

  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    const aActive = a.id === activeWorkspaceId ? 0 : 1;
    const bActive = b.id === activeWorkspaceId ? 0 : 1;
    return aActive - bActive;
  });

  function openDialog() {
    setSelectedWorkspaceId(activeWorkspaceId);
    setError("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (pending) return;
    setError("");
    dialogRef.current?.close();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !selectedWorkspaceId || selectedWorkspaceId === activeWorkspaceId) {
      return;
    }

    const targetWorkspace = workspaces.find(
      (item) => item.id === selectedWorkspaceId,
    );
    const formData = new FormData();
    formData.set("workspaceId", selectedWorkspaceId);

    setError("");
    startTransition(async () => {
      try {
        const result = await switchWorkspaceAction(formData);
        if (
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string" &&
          result.error.trim().length > 0
        ) {
          setError(toUserFacingErrorMessage(result.error));
          return;
        }

        dialogRef.current?.close();
        notify(
          targetWorkspace
            ? `Switched to ${targetWorkspace.name}.`
            : "Switched active workspace.",
        );
        router.refresh();
      } catch (err) {
        setError(toUserFacingErrorMessage(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="workspace-panel-trigger workspace-panel-secondary"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        Switch workspace
      </button>

      <dialog
        ref={dialogRef}
        className="workspace-switcher-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
      >
        <div className="workspace-panel-heading">
          <h2 id={titleId}>Switch workspace</h2>
          <button
            type="button"
            className="workspace-panel-close"
            aria-label="Close workspace switcher"
            onClick={closeDialog}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="workspace-switcher-dialog-body">
          <p className="workspace-meta">
            Select which workspace you want to view and manage.
          </p>

          <div className="workspace-switcher-options" role="radiogroup" aria-labelledby={titleId}>
            {orderedWorkspaces.map((item) => {
              const isSelected = selectedWorkspaceId === item.id;
              const isCurrent = item.id === activeWorkspaceId;

              return (
                <label
                  key={item.id}
                  className={`workspace-switcher-option${isSelected ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="workspaceId"
                    value={item.id}
                    checked={isSelected}
                    disabled={pending}
                    onChange={() => setSelectedWorkspaceId(item.id)}
                  />
                  <div className="workspace-switcher-option-content">
                    <div className="workspace-switcher-option-header">
                      <strong>{item.name}</strong>
                      <div className="workspace-switcher-badges">
                        <span className={getRoleBadgeClassName(item.role)}>
                          {WORKSPACE_ROLE_DETAILS[item.role].label}
                        </span>
                        {isCurrent && (
                          <span className="workspace-badge health-healthy">
                            Active
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="workspace-meta">
                      {item.competitorCount}{" "}
                      {item.competitorCount === 1 ? "competitor" : "competitors"} ·{" "}
                      {item.memberCount}{" "}
                      {item.memberCount === 1 ? "member" : "members"}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}

          <div className="workspace-switcher-actions">
            <button
              type="submit"
              className="workspace-primary"
              disabled={
                pending ||
                !selectedWorkspaceId ||
                selectedWorkspaceId === activeWorkspaceId
              }
            >
              {pending ? "Switching…" : "Switch workspace"}
            </button>
            <button
              type="button"
              className="workspace-panel-trigger workspace-panel-secondary"
              disabled={pending}
              onClick={closeDialog}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
