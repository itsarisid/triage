import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Search, LayoutGrid, List, Loader2, X, ArrowRight, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tables, Enums } from "@/integrations/supabase/types";
import { formatDistanceToNow, format, parseISO, subDays, startOfDay, endOfDay } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { NeonPatternDefs, neonPatternId } from "@/components/NeonPatternDefs";
import { useNeonCharts } from "@/hooks/use-neon-charts";
import { cn } from "@/lib/utils";
import { DrillDownDialog, type DrillDown } from "@/components/DrillDownDialog";

const STATUS_COLORS: Record<string, string> = {
  new: "hsl(var(--info))",
  assigned: "hsl(var(--primary))",
  in_progress: "hsl(var(--warning))",
  testing: "hsl(280, 60%, 55%)",
  resolved: "hsl(var(--success))",
  closed: "hsl(var(--muted-foreground))",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New", assigned: "Assigned", in_progress: "In Progress",
  testing: "Testing", resolved: "Resolved", closed: "Closed",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "hsl(var(--severity-critical))", high: "hsl(var(--severity-high))",
  medium: "hsl(var(--severity-medium))", low: "hsl(var(--severity-low))",
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

const ACTIVITY_PALETTE = [
  "hsl(234, 55%, 60%)", "hsl(199, 89%, 48%)", "hsl(38, 92%, 50%)",
  "hsl(142, 70%, 40%)", "hsl(280, 60%, 55%)", "hsl(0, 72%, 51%)",
  "hsl(25, 95%, 53%)", "hsl(190, 70%, 45%)",
];

type BugRow = Tables<"bugs">;
type LogRow = Pick<Tables<"activity_log">, "id" | "bug_id" | "user_id" | "action" | "old_value" | "new_value" | "created_at">;

const statusColumns: Enums<"bug_status">[] = ["new", "assigned", "in_progress", "testing", "resolved", "closed"];
type AnalyticsTab = "bugs" | "activity" | "logs";

type RangeKey = "7" | "30" | "90" | "365" | "all" | "custom";
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "365", label: "Last 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range" },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [allBugs, setAllBugs] = useState<BugRow[]>([]);
  const [allLogs, setAllLogs] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"kanban" | "table">("table");
  const [tab, setTab] = useState<AnalyticsTab>("bugs");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const { getFill } = useNeonCharts();

  useEffect(() => {
    const fetchAll = async () => {
      const [{ data: bugData }, { data: logData }] = await Promise.all([
        supabase.from("bugs").select("*").order("created_at", { ascending: false }),
        supabase.from("activity_log")
          .select("id,bug_id,user_id,action,old_value,new_value,created_at")
          .order("created_at", { ascending: false })
          .limit(5000),
      ]);
      setAllBugs(bugData ?? []);
      const rows = (logData ?? []) as LogRow[];
      setAllLogs(rows);

      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles").select("user_id,full_name").in("user_id", ids);
        setNames(Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.full_name || "Unknown"])));
      }
      setLoading(false);
    };
    fetchAll();

    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "bugs" }, () => fetchAll())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  /* ---------------- Global filters ---------------- */

  const range = useMemo(() => {
    if (rangeKey === "all") return { from: null as Date | null, to: null as Date | null };
    if (rangeKey === "custom") {
      return {
        from: customFrom ? startOfDay(parseISO(customFrom)) : null,
        to: customTo ? endOfDay(parseISO(customTo)) : null,
      };
    }
    return { from: startOfDay(subDays(new Date(), Number(rangeKey) - 1)), to: null as Date | null };
  }, [rangeKey, customFrom, customTo]);

  const inRange = (iso: string) => {
    const d = parseISO(iso);
    if (range.from && d < range.from) return false;
    if (range.to && d > range.to) return false;
    return true;
  };

  const bugs = useMemo(
    () => allBugs.filter((b) => {
      if (!inRange(b.created_at)) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (severityFilter && b.severity !== severityFilter) return false;
      return true;
    }),
    [allBugs, range, statusFilter, severityFilter]
  );

  const logs = useMemo(
    () => allLogs.filter((l) => {
      if (!inRange(l.created_at)) return false;
      if (actionFilter && l.action !== actionFilter) return false;
      if (userFilter && l.user_id !== userFilter) return false;
      return true;
    }),
    [allLogs, range, actionFilter, userFilter]
  );

  const allActions = useMemo(
    () => [...new Set(allLogs.map((l) => l.action))].sort(),
    [allLogs]
  );
  const allUsers = useMemo(
    () => [...new Set(allLogs.map((l) => l.user_id))]
      .map((id) => ({ id, name: names[id] || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allLogs, names]
  );

  /* ---------------- Bug metrics ---------------- */

  const counts = useMemo(() => ({
    total: bugs.length,
    critical: bugs.filter(b => b.severity === "critical").length,
    open: bugs.filter(b => !["resolved", "closed"].includes(b.status)).length,
    resolved: bugs.filter(b => b.status === "resolved" || b.status === "closed").length,
  }), [bugs]);

  const resolutionRate = counts.total ? Math.round((counts.resolved / counts.total) * 100) : 0;

  const statusData = useMemo(() => {
    const c: Record<string, number> = {};
    bugs.forEach(b => { c[b.status] = (c[b.status] || 0) + 1; });
    return Object.entries(STATUS_LABELS).map(([key, label]) => ({
      key, status: label, count: c[key] || 0, fill: STATUS_COLORS[key],
    }));
  }, [bugs]);

  const statusChartConfig: ChartConfig = Object.fromEntries(
    Object.entries(STATUS_LABELS).map(([k, label]) => [k, { label, color: STATUS_COLORS[k] }])
  );

  const severityData = useMemo(() => {
    const c: Record<string, number> = {};
    bugs.forEach(b => { c[b.severity] = (c[b.severity] || 0) + 1; });
    return Object.entries(SEVERITY_LABELS).map(([key, label]) => ({
      key, name: label, value: c[key] || 0, fill: SEVERITY_COLORS[key],
    }));
  }, [bugs]);

  const severityChartConfig: ChartConfig = Object.fromEntries(
    Object.entries(SEVERITY_LABELS).map(([k, label]) => [k, { label, color: SEVERITY_COLORS[k] }])
  );

  const bugTrend = useMemo(() => {
    const resolvedStatuses = new Set(["resolved", "closed"]);
    const out: { date: string; created: number; backlog: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const created = bugs.filter(b => format(parseISO(b.created_at), "yyyy-MM-dd") === format(day, "yyyy-MM-dd")).length;
      const backlog = bugs.filter(b => parseISO(b.created_at) <= day && !resolvedStatuses.has(b.status)).length;
      out.push({ date: format(day, "MMM dd"), created, backlog });
    }
    return out;
  }, [bugs]);

  const bugTrendConfig: ChartConfig = {
    created: { label: "Reported", color: "hsl(var(--primary))" },
    backlog: { label: "Open backlog", color: "hsl(var(--warning))" },
  };

  const resolutionGauge = [{ name: "Resolved", value: resolutionRate, fill: "hsl(var(--success))" }];

  /* ---------------- Activity / log metrics ---------------- */

  const logStats = useMemo(() => {
    const day = subDays(new Date(), 1), week = subDays(new Date(), 7);
    const last24 = logs.filter(l => parseISO(l.created_at) >= day).length;
    const last7 = logs.filter(l => parseISO(l.created_at) >= week);
    return {
      total: logs.length,
      last24,
      avgPerDay: Math.round((last7.length / 7) * 10) / 10,
      activeUsers: new Set(last7.map(l => l.user_id)).size,
      actionTypes: new Set(logs.map(l => l.action)).size,
    };
  }, [logs]);

  const activityTrend = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) days[format(subDays(new Date(), i), "MMM dd")] = 0;
    logs.forEach(l => { const k = format(parseISO(l.created_at), "MMM dd"); if (k in days) days[k]++; });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }, [logs]);

  const activityTrendConfig: ChartConfig = { count: { label: "Events", color: "hsl(234, 55%, 60%)" } };

  const byAction = useMemo(() => {
    const c: Record<string, number> = {};
    logs.forEach(l => { c[l.action] = (c[l.action] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, fill: ACTIVITY_PALETTE[i % ACTIVITY_PALETTE.length] }));
  }, [logs]);

  const actionConfig: ChartConfig = Object.fromEntries(byAction.map(a => [a.name, { label: a.name, color: a.fill }]));

  const byUser = useMemo(() => {
    const c: Record<string, number> = {};
    logs.forEach(l => { c[l.user_id] = (c[l.user_id] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, count], i) => ({ id, user: names[id] || "Unknown", count, fill: ACTIVITY_PALETTE[i % ACTIVITY_PALETTE.length] }));
  }, [logs, names]);

  const userConfig: ChartConfig = { count: { label: "Events", color: "hsl(142, 70%, 40%)" } };

  const byHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}`, count: 0 }));
    logs.forEach(l => { hours[parseISO(l.created_at).getHours()].count++; });
    return hours;
  }, [logs]);

  const hourConfig: ChartConfig = { count: { label: "Events", color: "hsl(199, 89%, 48%)" } };

  const byWeekday = useMemo(() => {
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const c = labels.map(day => ({ day, count: 0 }));
    logs.forEach(l => { c[parseISO(l.created_at).getDay()].count++; });
    return c;
  }, [logs]);

  const weekdayConfig: ChartConfig = { count: { label: "Events", color: "hsl(280, 60%, 55%)" } };

  const recentLogs = useMemo(() => logs.slice(0, 6), [logs]);
  const bugTitles = useMemo(
    () => Object.fromEntries(bugs.map(b => [b.id, b.tracking_id])),
    [bugs]
  );

  /* ---------------- Drill-down ---------------- */

  const openBugs = (title: string, description: string, predicate: (b: BugRow) => boolean) =>
    setDrill({ kind: "bugs", title, description, rows: bugs.filter(predicate) });

  const openLogs = (title: string, description: string, predicate: (l: LogRow) => boolean) =>
    setDrill({ kind: "logs", title, description, rows: logs.filter(predicate) });

  /* ---------------- Filtering ---------------- */

  const filtered = bugs.filter(b => {
    const q = search.toLowerCase();
    if (q && !b.title.toLowerCase().includes(q) && !b.tracking_id.toLowerCase().includes(q)) return false;
    return true;
  });

  const hasFilter = Boolean(
    statusFilter || severityFilter || actionFilter || userFilter || rangeKey !== "all"
  );

  const clearFilters = () => {
    setStatusFilter(null);
    setSeverityFilter(null);
    setActionFilter(null);
    setUserFilter(null);
    setRangeKey("all");
    setCustomFrom("");
    setCustomTo("");
  };

  const toggleStatus = (key: string) => setStatusFilter(prev => (prev === key ? null : key));
  const toggleSeverity = (key: string) => setSeverityFilter(prev => (prev === key ? null : key));

  const dimmed = (active: boolean, filter: string | null) => (filter && !active ? 0.25 : 1);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const tabs: { key: AnalyticsTab; label: string; hint: string }[] = [
    { key: "bugs", label: "Bugs", hint: `${counts.total} tracked` },
    { key: "activity", label: "Activity", hint: `${logStats.activeUsers} active users` },
    { key: "logs", label: "Logs", hint: `${logStats.total} events` },
  ];

  const summary = tab === "bugs"
    ? [
        { label: "Total bugs", value: counts.total },
        { label: "Critical", value: counts.critical },
        { label: "Open", value: counts.open },
        { label: "Resolution rate", value: `${resolutionRate}%` },
      ]
    : tab === "activity"
    ? [
        { label: "Total events", value: logStats.total },
        { label: "Last 24 hours", value: logStats.last24 },
        { label: "Active users (7d)", value: logStats.activeUsers },
        { label: "Avg events/day", value: logStats.avgPerDay },
      ]
    : [
        { label: "Log entries", value: logStats.total },
        { label: "Action types", value: logStats.actionTypes },
        { label: "Peak hour", value: `${byHour.reduce((a, b) => (b.count > a.count ? b : a), byHour[0]).hour}:00` },
        { label: "Busiest day", value: byWeekday.reduce((a, b) => (b.count > a.count ? b : a), byWeekday[0]).day },
      ];

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 md:px-6 h-11 border-b border-border shrink-0">
          <h1 className="text-[13px] font-medium">Dashboard</h1>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="h-7 text-[12px] gap-1.5">
              <Link to="/bugs/new">
                <Plus className="h-3.5 w-3.5" /> Report bug
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="p-4 md:p-6 space-y-6 max-w-[1400px]">
            <NeonPatternDefs
              colors={[
                ...Object.values(STATUS_COLORS),
                ...Object.values(SEVERITY_COLORS),
                ...ACTIVITY_PALETTE,
                "hsl(var(--success))",
              ]}
            />

            {/* Analytics tabs */}
            <div className="flex items-center gap-1 border border-border rounded-md p-1 w-fit">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "px-3 py-1.5 rounded text-[12px] transition-colors flex items-center gap-2",
                    tab === t.key
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {t.label}
                  <span className="text-[10px] opacity-60">{t.hint}</span>
                </button>
              ))}
            </div>

            {/* Global filters */}
            <div className="border border-border rounded-md p-3 flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mr-1">
                <Filter className="h-3.5 w-3.5" /> Filters
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Date range</p>
                <Select value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
                  <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RANGE_OPTIONS.map((o) => (
                      <SelectItem key={o.key} value={o.key} className="text-[12px]">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {rangeKey === "custom" && (
                <>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">From</p>
                    <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-8 w-[140px] text-[12px]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">To</p>
                    <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                      className="h-8 w-[140px] text-[12px]" />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Status</p>
                <Select value={statusFilter ?? "all"} onValueChange={(v) => setStatusFilter(v === "all" ? null : v)}>
                  <SelectTrigger className="h-8 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[12px]">All statuses</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k} className="text-[12px]">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Severity</p>
                <Select value={severityFilter ?? "all"} onValueChange={(v) => setSeverityFilter(v === "all" ? null : v)}>
                  <SelectTrigger className="h-8 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[12px]">All severities</SelectItem>
                    {Object.entries(SEVERITY_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k} className="text-[12px]">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Event type</p>
                <Select value={actionFilter ?? "all"} onValueChange={(v) => setActionFilter(v === "all" ? null : v)}>
                  <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[12px]">All events</SelectItem>
                    {allActions.map((a) => (
                      <SelectItem key={a} value={a} className="text-[12px]">{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">User</p>
                <Select value={userFilter ?? "all"} onValueChange={(v) => setUserFilter(v === "all" ? null : v)}>
                  <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[12px]">All users</SelectItem>
                    {allUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-[12px]">{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {hasFilter && (
                <Button variant="ghost" size="sm" className="h-8 text-[12px] ml-auto" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1" /> Reset filters
                </Button>
              )}
            </div>



            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-md overflow-hidden">
              {summary.map((stat) => (
                <div key={stat.label} className="bg-background p-4">
                  <p className="text-[12px] text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-medium mt-1">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* ---------- BUGS ANALYTICS ---------- */}
            {tab === "bugs" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border rounded-md overflow-hidden">
                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Bugs by status</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Click a bar to open the matching bugs</p>
                  <ChartContainer config={statusChartConfig} className="h-[200px] w-full">
                    <BarChart data={statusData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="status" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                      <Bar dataKey="count" radius={0} className="cursor-pointer"
                        onClick={(d: { key?: string }) => d?.key && openBugs(
                          `Bugs · ${STATUS_LABELS[d.key]}`, "Status drill-down", (b) => b.status === d.key
                        )}>
                        {statusData.map((entry, i) => (
                          <Cell
                            key={i}
                            {...getFill(entry.fill)}
                            fillOpacity={dimmed(statusFilter === entry.key, statusFilter)}
                            strokeOpacity={dimmed(statusFilter === entry.key, statusFilter)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Severity distribution</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Click a slice to open the matching bugs</p>
                  <ChartContainer config={severityChartConfig} className="h-[200px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie
                        data={severityData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={45} outerRadius={75} paddingAngle={2} className="cursor-pointer"
                        onClick={(d: { key?: string }) => d?.key && openBugs(
                          `Bugs · ${SEVERITY_LABELS[d.key]} severity`, "Severity drill-down", (b) => b.severity === d.key
                        )}
                      >
                        {severityData.map((entry, i) => (
                          <Cell
                            key={i}
                            {...getFill(entry.fill)}
                            fillOpacity={dimmed(severityFilter === entry.key, severityFilter)}
                            strokeOpacity={dimmed(severityFilter === entry.key, severityFilter)}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Reported vs open backlog</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Last 30 days · click a day to see bugs reported</p>
                  <ChartContainer config={bugTrendConfig} className="h-[200px] w-full">
                    <AreaChart data={bugTrend} className="cursor-pointer"
                      onClick={(e: { activeLabel?: string }) => e?.activeLabel && openBugs(
                        `Bugs reported · ${e.activeLabel}`, "Daily drill-down",
                        (b) => format(parseISO(b.created_at), "MMM dd") === e.activeLabel
                      )}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={5} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="backlog" stroke="hsl(var(--warning))" strokeWidth={1.5}
                        fill={`url(#${neonPatternId("hsl(var(--warning))")})`} fillOpacity={1} />
                      <Area type="monotone" dataKey="created" stroke="hsl(var(--primary))" strokeWidth={1.5}
                        fill={`url(#${neonPatternId("hsl(var(--primary))")})`} fillOpacity={1} />
                    </AreaChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Resolution rate</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Resolved &amp; closed share of all bugs</p>
                  <ChartContainer config={{ value: { label: "Resolved", color: "hsl(var(--success))" } }} className="h-[200px] w-full">
                    <RadialBarChart
                      data={resolutionGauge} startAngle={90} endAngle={-270}
                      innerRadius={62} outerRadius={90}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <RadialBar dataKey="value" background cornerRadius={2} fill="hsl(var(--success))" />
                      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
                        className="fill-foreground text-2xl font-medium">
                        {`${resolutionRate}%`}
                      </text>
                    </RadialBarChart>
                  </ChartContainer>
                </div>
              </div>
            )}

            {/* ---------- ACTIVITY ANALYTICS ---------- */}
            {tab === "activity" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border rounded-md overflow-hidden">
                <div className="bg-background p-4 lg:col-span-2">
                  <p className="text-[13px] font-medium mb-1">Activity over the last 30 days</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Events recorded across all bugs · click a day to inspect</p>
                  <ChartContainer config={activityTrendConfig} className="h-[220px] w-full">
                    <LineChart data={activityTrend} className="cursor-pointer"
                      onClick={(e: { activeLabel?: string }) => e?.activeLabel && openLogs(
                        `Events · ${e.activeLabel}`, "Daily drill-down",
                        (l) => format(parseISO(l.created_at), "MMM dd") === e.activeLabel
                      )}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="count" stroke="hsl(234, 55%, 60%)" strokeWidth={1.5}
                        dot={{ r: 2 }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Events by action</p>
                  <p className="text-[12px] text-muted-foreground mb-4">What the team does most · click a slice to inspect</p>
                  {byAction.length === 0 ? (
                    <p className="h-[220px] flex items-center justify-center text-[13px] text-muted-foreground">No events yet</p>
                  ) : (
                  <ChartContainer config={actionConfig} className="h-[220px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie data={byAction} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}
                        className="cursor-pointer"
                        onClick={(d: { name?: string }) => d?.name && openLogs(
                          `Events · ${d.name}`, "Action drill-down", (l) => l.action === d.name
                        )}>
                        {byAction.map((entry, i) => <Cell key={i} {...getFill(entry.fill)} />)}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  )}

                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Most active teammates</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Top contributors · click a bar to inspect</p>
                  {byUser.length === 0 ? (
                    <p className="h-[220px] flex items-center justify-center text-[13px] text-muted-foreground">No contributors yet</p>
                  ) : (
                  <ChartContainer config={userConfig} className="h-[220px] w-full">
                    <BarChart data={byUser} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="user" width={100} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                      <Bar dataKey="count" radius={0} className="cursor-pointer"
                        onClick={(d: { id?: string; user?: string }) => d?.id && openLogs(
                          `Events by ${d.user}`, "Teammate drill-down", (l) => l.user_id === d.id
                        )}>
                        {byUser.map((entry, i) => <Cell key={i} {...getFill(entry.fill)} />)}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  )}

                </div>
              </div>
            )}

            {/* ---------- LOG ANALYTICS ---------- */}
            {tab === "logs" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border rounded-md overflow-hidden">
                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Events by hour of day</p>
                  <p className="text-[12px] text-muted-foreground mb-4">When the workspace is busiest · click an hour to inspect</p>
                  <ChartContainer config={hourConfig} className="h-[220px] w-full">
                    <BarChart data={byHour}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                      <Bar dataKey="count" radius={0} className="cursor-pointer" {...getFill("hsl(199, 89%, 48%)")}
                        onClick={(d: { hour?: string }) => d?.hour !== undefined && openLogs(
                          `Events at ${d.hour}:00`, "Hour-of-day drill-down",
                          (l) => parseISO(l.created_at).getHours() === Number(d.hour)
                        )} />
                    </BarChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4">
                  <p className="text-[13px] font-medium mb-1">Events by weekday</p>
                  <p className="text-[12px] text-muted-foreground mb-4">Weekly rhythm · click a day to inspect</p>
                  <ChartContainer config={weekdayConfig} className="h-[220px] w-full">
                    <BarChart data={byWeekday}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                      <Bar dataKey="count" radius={0} className="cursor-pointer" {...getFill("hsl(280, 60%, 55%)")}
                        onClick={(d: { day?: string }) => {
                          const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                          const idx = labels.indexOf(d?.day ?? "");
                          if (idx >= 0) openLogs(`Events on ${d.day}`, "Weekday drill-down",
                            (l) => parseISO(l.created_at).getDay() === idx);
                        }} />
                    </BarChart>
                  </ChartContainer>
                </div>

                <div className="bg-background p-4 lg:col-span-2">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[13px] font-medium mb-1">Latest log entries</p>
                      <p className="text-[12px] text-muted-foreground">Most recent changes recorded</p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-7 text-[12px] gap-1">
                      <Link to="/logs">Open logs <ArrowRight className="h-3.5 w-3.5" /></Link>
                    </Button>
                  </div>
                  {recentLogs.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground py-6 text-center">No log entries yet</p>
                  ) : (
                    <ul className="divide-y divide-border border border-border rounded-md">
                      {recentLogs.map((l) => (
                        <li key={l.id}>
                          <Link to={`/logs/${l.id}`} className="flex items-center gap-3 px-3 py-2 text-[12.5px] hover:bg-muted/40">
                            <Badge variant="secondary" className="font-normal text-[11px]">{l.action}</Badge>
                            <span className="text-muted-foreground truncate flex-1">
                              {names[l.user_id] || "Unknown"}
                              {l.bug_id && bugTitles[l.bug_id] ? ` · ${bugTitles[l.bug_id]}` : ""}
                              {l.new_value ? ` → ${l.new_value}` : ""}
                            </span>
                            <span className="text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                              {format(parseISO(l.created_at), "MMM dd HH:mm")}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Search & View Toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 max-w-sm min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search bugs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-[13px] bg-transparent"
                />
              </div>

              {statusFilter && (
                <button
                  onClick={() => setStatusFilter(null)}
                  className="flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[12px] hover:bg-muted/50"
                >
                  Status: {STATUS_LABELS[statusFilter]} <X className="h-3 w-3" />
                </button>
              )}
              {severityFilter && (
                <button
                  onClick={() => setSeverityFilter(null)}
                  className="flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-[12px] hover:bg-muted/50"
                >
                  Severity: {SEVERITY_LABELS[severityFilter]} <X className="h-3 w-3" />
                </button>
              )}
              {hasFilter && (
                <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={clearFilters}>
                  Clear all
                </Button>
              )}

              <div className="flex items-center border rounded-md ml-auto">
                <Button variant={view === "table" ? "secondary" : "ghost"} size="sm" onClick={() => setView("table")} className="h-8 w-8 p-0">
                  <List className="h-3.5 w-3.5" />
                </Button>
                <Button variant={view === "kanban" ? "secondary" : "ghost"} size="sm" onClick={() => setView("kanban")} className="h-8 w-8 p-0">
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Table View */}
            {view === "table" && (
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left font-medium text-muted-foreground px-3 py-2">ID</th>
                      <th className="text-left font-medium text-muted-foreground px-3 py-2">Title</th>
                      <th className="text-left font-medium text-muted-foreground px-3 py-2">Status</th>
                      <th className="text-left font-medium text-muted-foreground px-3 py-2">Priority</th>
                      <th className="text-left font-medium text-muted-foreground px-3 py-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground text-[13px]">No bugs found</td>
                      </tr>
                    ) : (
                      filtered.map((bug) => (
                        <tr
                          key={bug.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => navigate(`/bugs/${bug.id}`)}
                        >
                          <td className="px-3 py-2 text-muted-foreground font-mono text-[12px]">{bug.tracking_id}</td>
                          <td className="px-3 py-2 font-medium">{bug.title}</td>
                          <td className="px-3 py-2"><StatusBadge status={bug.status} /></td>
                          <td className="px-3 py-2"><SeverityBadge severity={bug.severity} /></td>
                          <td className="px-3 py-2 text-muted-foreground text-[12px] whitespace-nowrap">
                            {formatDistanceToNow(new Date(bug.created_at), { addSuffix: true })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Kanban View */}
            {view === "kanban" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {statusColumns.map((status) => {
                  const columnBugs = filtered.filter(b => b.status === status);
                  return (
                    <div key={status} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <StatusBadge status={status} />
                        <span className="text-[11px] text-muted-foreground">{columnBugs.length}</span>
                      </div>
                      <div className="space-y-1">
                        {columnBugs.map((bug) => (
                          <Link key={bug.id} to={`/bugs/${bug.id}`}>
                            <div className="border border-border rounded-md p-2.5 hover:bg-muted/30 transition-colors cursor-pointer space-y-1.5">
                              <p className="text-[11px] text-muted-foreground font-mono">{bug.tracking_id}</p>
                              <p className="text-[13px] font-medium leading-snug line-clamp-2">{bug.title}</p>
                              <div className="flex items-center justify-between">
                                <SeverityBadge severity={bug.severity} />
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDistanceToNow(new Date(bug.created_at), { addSuffix: true })}
                                </span>
                              </div>
                            </div>
                          </Link>
                        ))}
                        {columnBugs.length === 0 && (
                          <div className="border border-dashed border-border rounded-md p-3 text-center">
                            <p className="text-[11px] text-muted-foreground">No bugs</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <DrillDownDialog drill={drill} names={names} onOpenChange={(o) => !o && setDrill(null)} />
    </AppLayout>
  );
}
