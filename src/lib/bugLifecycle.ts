import type { Enums } from "@/integrations/supabase/types";

export type BugStatus = Enums<"bug_status">;

/** Allowed transitions for the bug lifecycle state machine. */
export const LIFECYCLE_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  new: ["assigned", "in_progress", "closed"],
  assigned: ["in_progress", "testing", "closed"],
  in_progress: ["testing", "resolved", "closed"],
  testing: ["in_progress", "resolved", "closed"],
  resolved: ["in_progress", "closed"],
  closed: ["new", "in_progress"],
};

export const RESOLVED_STATES: BugStatus[] = ["resolved", "closed"];
export const TERMINAL_STATE: BugStatus = "closed";

export const STATUS_LABEL: Record<BugStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In Progress",
  testing: "Testing",
  resolved: "Resolved",
  closed: "Closed",
};

export function isResolvedStatus(status: string): boolean {
  return RESOLVED_STATES.includes(status as BugStatus);
}

export function isOpenStatus(status: string): boolean {
  return !isResolvedStatus(status);
}

export function canTransition(from: BugStatus, to: BugStatus): boolean {
  return from !== to && LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function nextStates(from: BugStatus): BugStatus[] {
  return LIFECYCLE_TRANSITIONS[from];
}

/** Semantic name of a transition — used as the activity_log action. */
export function transitionAction(from: BugStatus, to: BugStatus): string {
  if (isResolvedStatus(from) && isOpenStatus(to)) return "reopen";
  if (to === "closed") return "close";
  if (to === "resolved") return "resolve";
  return "status_change";
}

export const REOPEN_ACTION = "reopen";
export const CLOSE_ACTION = "close";

/** Where a reopen should land, based on the current terminal-ish state. */
export function reopenTarget(from: BugStatus): BugStatus {
  return from === "closed" ? "new" : "in_progress";
}

type LifecycleBug = { id: string; status: string };
type LifecycleLog = { bug_id: string; action: string };

export interface LifecycleMetrics {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  reopened: number;
  resolutionRate: number;
  reopenRate: number;
  reopenedBugIds: Set<string>;
}

export function lifecycleMetrics(
  bugs: LifecycleBug[],
  logs: LifecycleLog[] = []
): LifecycleMetrics {
  const total = bugs.length;
  const resolved = bugs.filter((b) => b.status === "resolved").length;
  const closed = bugs.filter((b) => b.status === "closed").length;
  const open = bugs.filter((b) => isOpenStatus(b.status)).length;

  const bugIds = new Set(bugs.map((b) => b.id));
  const reopenedBugIds = new Set(
    logs
      .filter((l) => l.action === REOPEN_ACTION && l.bug_id && bugIds.has(l.bug_id))
      .map((l) => l.bug_id)
  );

  return {
    total,
    open,
    resolved,
    closed,
    reopened: reopenedBugIds.size,
    resolutionRate: total ? Math.round(((resolved + closed) / total) * 100) : 0,
    reopenRate: total ? Math.round((reopenedBugIds.size / total) * 100) : 0,
    reopenedBugIds,
  };
}
