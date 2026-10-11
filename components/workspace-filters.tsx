"use client";

import { useId, useState, type ReactNode } from "react";

export function WorkspaceFilters({ children, active }: { children: ReactNode; active: boolean }) {
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  return (
    <div className="workspace-filter-fields" data-expanded={expanded}>
      <button className="workspace-filter-toggle" type="button" aria-expanded={expanded} aria-controls={id}
        onClick={() => setExpanded(!expanded)}>
        Filters<span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div id={id} className="workspace-filter-grid">{children}</div>
    </div>
  );
}
