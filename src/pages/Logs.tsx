import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { RefreshCw, ScrollText, Search } from "lucide-react";

type LogRow = {
  id: string;
  bug_id: string;
  user_id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

type EnrichedLog = LogRow & {
  bug_title: string | null;
  bug_tracking_id: string | null;
  user_name: string | null;
};

const PAGE_SIZE = 50;

export default function Logs({
  basePath = "/logs",
  title = "Application Logs",
}: { basePath?: string; title?: string } = {}) {
  const [logs, setLogs] = useState<EnrichedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(0);

  const load = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    const { data } = await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    const rows = (data ?? []) as LogRow[];
    const bugIds = [...new Set(rows.map((r) => r.bug_id).filter(Boolean))];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

    const [{ data: bugs }, { data: profiles }] = await Promise.all([
      bugIds.length
        ? supabase.from("bugs").select("id,title,tracking_id").in("id", bugIds)
        : Promise.resolve({ data: [] as { id: string; title: string; tracking_id: string }[] }),
      userIds.length
        ? supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as { user_id: string; full_name: string }[] }),
    ]);

    const bugMap = new Map((bugs ?? []).map((b) => [b.id, b]));
    const userMap = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

    setLogs(
      rows.map((r) => ({
        ...r,
        bug_title: bugMap.get(r.bug_id)?.title ?? null,
        bug_tracking_id: bugMap.get(r.bug_id)?.tracking_id ?? null,
        user_name: userMap.get(r.user_id) ?? null,
      }))
    );
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("activity-log-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo(
    () => [...new Set(logs.map((l) => l.action))].sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (action !== "all" && l.action !== action) return false;
      if (!q) return true;
      return [l.action, l.old_value, l.new_value, l.bug_title, l.bug_tracking_id, l.user_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [logs, search, action]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, action]);

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="px-4 md:px-6 h-11 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-[13px] font-medium">{title}</h1>
            <span className="text-[12px] text-muted-foreground">{filtered.length}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-7 text-[12px]">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="px-4 md:px-6 py-3 border-b border-border flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs, users, bugs..."
              className="pl-8 h-8 text-[13px]"
            />
          </div>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-8 w-full sm:w-52 text-[13px]">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 md:p-6 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : current.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-muted-foreground">
              No log entries found.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr className="text-left text-muted-foreground">
                  <th className="font-normal px-4 md:px-6 py-2 w-44">Time</th>
                  <th className="font-normal px-2 py-2 w-40">Action</th>
                  <th className="font-normal px-2 py-2 w-40">User</th>
                  <th className="font-normal px-2 py-2">Detail</th>
                  <th className="font-normal px-2 md:px-6 py-2 w-44">Bug</th>
                </tr>
              </thead>
              <tbody>
                {current.map((l) => (
                  <tr key={l.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-4 md:px-6 py-2 whitespace-nowrap font-mono">
                      <Link to={`${basePath}/${l.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                        {format(parseISO(l.created_at), "yyyy-MM-dd HH:mm:ss")}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="secondary" className="text-[11px] font-normal">{l.action}</Badge>
                    </td>
                    <td className="px-2 py-2 truncate">{l.user_name || "Unknown"}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {l.old_value || l.new_value ? (
                        <span>
                          {l.old_value && <span className="line-through opacity-70">{l.old_value}</span>}
                          {l.old_value && l.new_value && <span className="mx-1">&rarr;</span>}
                          {l.new_value && <span className="text-foreground">{l.new_value}</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-2 md:px-6 py-2">
                      {l.bug_id ? (
                        <Link to={`/bugs/${l.bug_id}`} className="hover:underline">
                          <span className="font-mono text-[11px] text-muted-foreground mr-1">
                            {l.bug_tracking_id}
                          </span>
                          <span className="truncate">{l.bug_title}</span>
                        </Link>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && pageCount > 1 && (
          <div className="border-t border-border px-4 md:px-6 py-2 flex items-center justify-between text-[12px]">
            <span className="text-muted-foreground">Page {page + 1} of {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-[12px]" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-[12px]" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
