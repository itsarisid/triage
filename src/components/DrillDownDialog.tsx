import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

type BugRow = Tables<"bugs">;
export type DrillLogRow = Pick<
  Tables<"activity_log">,
  "id" | "bug_id" | "user_id" | "action" | "old_value" | "new_value" | "created_at"
>;

export type DrillDown =
  | { kind: "bugs"; title: string; description?: string; rows: BugRow[] }
  | { kind: "logs"; title: string; description?: string; rows: DrillLogRow[] };

const PAGE_SIZE = 10;
const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<string, number> = {
  new: 1, assigned: 2, in_progress: 3, testing: 4, resolved: 5, closed: 6,
};

type SortDir = "asc" | "desc";

function SortHeader({
  label, active, dir, onClick, className,
}: { label: string; active: boolean; dir: SortDir; onClick: () => void; className?: string }) {
  return (
    <th className={cn("text-left font-medium text-muted-foreground py-2 px-3", className)}>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

export function DrillDownDialog({
  drill, names, onOpenChange,
}: {
  drill: DrillDown | null;
  names: Record<string, string>;
  onOpenChange: (open: boolean) => void;
}) {
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setSortKey("created_at");
    setSortDir("desc");
    setPage(0);
  }, [drill]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "created_at" ? "desc" : "asc"); }
    setPage(0);
  };

  const sorted = useMemo(() => {
    if (!drill) return [] as (BugRow | DrillLogRow)[];
    const rows = [...drill.rows] as (BugRow & DrillLogRow)[];
    const value = (r: BugRow & DrillLogRow): string | number => {
      switch (sortKey) {
        case "created_at": return parseISO(r.created_at).getTime();
        case "severity": return SEVERITY_ORDER[r.severity] ?? 0;
        case "status": return STATUS_ORDER[r.status] ?? 0;
        case "user": return (names[r.user_id] || "Unknown").toLowerCase();
        case "action": return r.action?.toLowerCase() ?? "";
        case "tracking_id": return r.tracking_id?.toLowerCase() ?? "";
        case "title": return r.title?.toLowerCase() ?? "";
        case "detail": return `${r.old_value ?? ""}${r.new_value ?? ""}`.toLowerCase();
        default: return 0;
      }
    };
    rows.sort((a, b) => {
      const va = value(a), vb = value(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [drill, sortKey, sortDir, names]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <Dialog open={Boolean(drill)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[14px]">{drill?.title}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {drill?.description ? `${drill.description} · ` : ""}
            {sorted.length} {drill?.kind === "logs" ? "event" : "bug"}{sorted.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto border border-border rounded-md">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">No matching records</p>
          ) : drill?.kind === "bugs" ? (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <SortHeader label="ID" active={sortKey === "tracking_id"} dir={sortDir} onClick={() => toggleSort("tracking_id")} />
                  <SortHeader label="Title" active={sortKey === "title"} dir={sortDir} onClick={() => toggleSort("title")} />
                  <SortHeader label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                  <SortHeader label="Severity" active={sortKey === "severity"} dir={sortDir} onClick={() => toggleSort("severity")} />
                  <SortHeader label="Created" active={sortKey === "created_at"} dir={sortDir} onClick={() => toggleSort("created_at")} />
                </tr>
              </thead>
              <tbody>
                {(current as BugRow[]).map((b) => (
                  <tr key={b.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground whitespace-nowrap">
                      <Link to={`/bugs/${b.id}`} className="hover:underline">{b.tracking_id}</Link>
                    </td>
                    <td className="px-3 py-2 max-w-[240px] truncate">
                      <Link to={`/bugs/${b.id}`} className="hover:underline">{b.title}</Link>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                    <td className="px-3 py-2"><SeverityBadge severity={b.severity} /></td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {format(parseISO(b.created_at), "MMM dd, yyyy HH:mm")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <SortHeader label="Time" active={sortKey === "created_at"} dir={sortDir} onClick={() => toggleSort("created_at")} />
                  <SortHeader label="Action" active={sortKey === "action"} dir={sortDir} onClick={() => toggleSort("action")} />
                  <SortHeader label="User" active={sortKey === "user"} dir={sortDir} onClick={() => toggleSort("user")} />
                  <SortHeader label="Detail" active={sortKey === "detail"} dir={sortDir} onClick={() => toggleSort("detail")} />
                </tr>
              </thead>
              <tbody>
                {(current as DrillLogRow[]).map((l) => (
                  <tr key={l.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-[11.5px] whitespace-nowrap">
                      <Link to={`/logs/${l.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                        {format(parseISO(l.created_at), "MMM dd HH:mm:ss")}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[11px] font-normal">{l.action}</Badge>
                    </td>
                    <td className="px-3 py-2 truncate">{names[l.user_id] || "Unknown"}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate">
                      {l.old_value || l.new_value ? (
                        <>
                          {l.old_value && <span className="line-through opacity-70">{l.old_value}</span>}
                          {l.old_value && l.new_value && <span className="mx-1">&rarr;</span>}
                          {l.new_value && <span className="text-foreground">{l.new_value}</span>}
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between text-[12px]">
          <span className="text-muted-foreground">
            {sorted.length === 0 ? "No records" : `Page ${page + 1} of ${pageCount}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[12px]"
              disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" className="h-7 text-[12px]"
              disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
