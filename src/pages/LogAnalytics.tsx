import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { Activity } from "lucide-react";

type LogRow = {
  id: string;
  user_id: string;
  action: string;
  created_at: string;
};

const PALETTE = [
  "hsl(234, 55%, 60%)", "hsl(199, 89%, 48%)", "hsl(38, 92%, 50%)",
  "hsl(142, 70%, 40%)", "hsl(280, 60%, 55%)", "hsl(0, 72%, 51%)",
  "hsl(25, 95%, 53%)", "hsl(190, 70%, 45%)",
];

export default function LogAnalytics({ title = "Log Analytics" }: { title?: string } = {}) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("activity_log")
        .select("id,user_id,action,created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      const rows = (data ?? []) as LogRow[];
      setLogs(rows);
      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles").select("user_id,full_name").in("user_id", ids);
        setNames(Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.full_name || "Unknown"])));
      }
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const day = subDays(now, 1), week = subDays(now, 7);
    const last24 = logs.filter((l) => parseISO(l.created_at) >= day).length;
    const last7 = logs.filter((l) => parseISO(l.created_at) >= week).length;
    return {
      total: logs.length,
      last24,
      avgPerDay: Math.round((last7 / 7) * 10) / 10,
      activeUsers: new Set(logs.filter((l) => parseISO(l.created_at) >= week).map((l) => l.user_id)).size,
    };
  }, [logs]);

  const trend = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) days[format(subDays(new Date(), i), "MMM dd")] = 0;
    logs.forEach((l) => { const k = format(parseISO(l.created_at), "MMM dd"); if (k in days) days[k]++; });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }, [logs]);

  const byAction = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach((l) => { counts[l.action] = (counts[l.action] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value, fill: PALETTE[i % PALETTE.length] }));
  }, [logs]);

  const byUser = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach((l) => { counts[l.user_id] = (counts[l.user_id] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count], i) => ({ user: names[id] || "Unknown", count, fill: PALETTE[i % PALETTE.length] }));
  }, [logs, names]);

  const byHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, count: 0 }));
    logs.forEach((l) => { hours[parseISO(l.created_at).getHours()].count++; });
    return hours;
  }, [logs]);

  const trendConfig: ChartConfig = { count: { label: "Events", color: "hsl(234, 55%, 60%)" } };
  const hourConfig: ChartConfig = { count: { label: "Events", color: "hsl(199, 89%, 48%)" } };
  const userConfig: ChartConfig = { count: { label: "Events", color: "hsl(142, 70%, 40%)" } };
  const actionConfig: ChartConfig = Object.fromEntries(byAction.map((a) => [a.name, { label: a.name, color: a.fill }]));

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-col h-full">
          <div className="px-4 md:px-6 h-11 border-b border-border flex items-center">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="p-4 md:p-6 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-md overflow-hidden">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const cards = [
    { label: "Total events", value: stats.total },
    { label: "Last 24 hours", value: stats.last24 },
    { label: "Avg / day (7d)", value: stats.avgPerDay },
    { label: "Active users (7d)", value: stats.activeUsers },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="px-4 md:px-6 h-11 border-b border-border flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-[13px] font-medium">{title}</h1>
        </div>

        <div className="p-4 md:p-6 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-md overflow-hidden">
            {cards.map((c) => (
              <div key={c.label} className="bg-card p-4">
                <p className="text-[12px] text-muted-foreground">{c.label}</p>
                <p className="text-2xl font-semibold mt-1">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[13px] font-medium mb-3">Activity over the last 30 days</p>
            <ChartContainer config={trendConfig} className="h-64 w-full">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} interval={4} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-[13px] font-medium mb-3">Events by action</p>
              <ChartContainer config={actionConfig} className="h-64 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie data={byAction} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {byAction.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </div>

            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-[13px] font-medium mb-3">Most active users</p>
              <ChartContainer config={userConfig} className="h-64 w-full">
                <BarChart data={byUser} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="user" tickLine={false} axisLine={false} width={110} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={3}>
                    {byUser.map((entry) => <Cell key={entry.user} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[13px] font-medium mb-3">Events by hour of day</p>
            <ChartContainer config={hourConfig} className="h-56 w-full">
              <BarChart data={byHour}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={2} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={3} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
