import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ArrowLeft, ScrollText } from "lucide-react";

type LogRow = {
  id: string;
  bug_id: string;
  user_id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

type Related = { id: string; action: string; created_at: string };

export default function LogDetail({
  basePath = "/logs",
  title = "Log Detail",
}: { basePath?: string; title?: string } = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<LogRow | null>(null);
  const [bug, setBug] = useState<{ id: string; title: string; tracking_id: string; status: string; severity: string } | null>(null);
  const [userName, setUserName] = useState<string>("Unknown");
  const [related, setRelated] = useState<Related[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("activity_log").select("*").eq("id", id).maybeSingle();
      const row = data as LogRow | null;
      setLog(row);

      if (row) {
        const [{ data: b }, { data: p }, { data: rel }] = await Promise.all([
          row.bug_id
            ? supabase.from("bugs").select("id,title,tracking_id,status,severity").eq("id", row.bug_id).maybeSingle()
            : Promise.resolve({ data: null }),
          supabase.from("profiles").select("full_name").eq("user_id", row.user_id).maybeSingle(),
          row.bug_id
            ? supabase.from("activity_log").select("id,action,created_at").eq("bug_id", row.bug_id)
                .order("created_at", { ascending: false }).limit(20)
            : Promise.resolve({ data: [] }),
        ]);
        setBug(b as typeof bug);
        setUserName((p as { full_name?: string } | null)?.full_name || "Unknown");
        setRelated((rel ?? []) as Related[]);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <AppLayout>
        <div className="p-4 md:p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (!log) {
    return (
      <AppLayout>
        <div className="p-10 text-center space-y-3">
          <p className="text-[13px] text-muted-foreground">Log entry not found.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(basePath)}>Back to logs</Button>
        </div>
      </AppLayout>
    );
  }

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Log ID", value: <span className="font-mono text-[12px]">{log.id}</span> },
    { label: "Action", value: <Badge variant="secondary" className="font-normal">{log.action}</Badge> },
    { label: "User", value: userName },
    { label: "User ID", value: <span className="font-mono text-[12px]">{log.user_id}</span> },
    {
      label: "Timestamp",
      value: (
        <span>
          {format(parseISO(log.created_at), "yyyy-MM-dd HH:mm:ss")}{" "}
          <span className="text-muted-foreground">({formatDistanceToNow(parseISO(log.created_at), { addSuffix: true })})</span>
        </span>
      ),
    },
    { label: "Previous value", value: log.old_value ? <span className="line-through opacity-70">{log.old_value}</span> : "—" },
    { label: "New value", value: log.new_value || "—" },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="px-4 md:px-6 h-11 border-b border-border flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(basePath)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-[13px] font-medium">{title}</h1>
        </div>

        <div className="p-4 md:p-6 space-y-4 max-w-4xl">
          <div className="rounded-md border border-border bg-card divide-y divide-border">
            {fields.map((f) => (
              <div key={f.label} className="grid grid-cols-1 sm:grid-cols-3 gap-1 px-4 py-2.5 text-[13px]">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="sm:col-span-2 break-all">{f.value}</span>
              </div>
            ))}
          </div>

          {bug && (
            <div className="rounded-md border border-border bg-card p-4 space-y-2">
              <p className="text-[13px] font-medium">Related bug</p>
              <Link to={`/bugs/${bug.id}`} className="block text-[13px] hover:underline">
                <span className="font-mono text-[11px] text-muted-foreground mr-2">{bug.tracking_id}</span>
                {bug.title}
              </Link>
              <div className="flex gap-2">
                <Badge variant="outline" className="font-normal text-[11px]">{bug.status}</Badge>
                <Badge variant="outline" className="font-normal text-[11px]">{bug.severity}</Badge>
              </div>
            </div>
          )}

          {related.length > 1 && (
            <div className="rounded-md border border-border bg-card">
              <p className="text-[13px] font-medium px-4 py-2.5 border-b border-border">History for this bug</p>
              <ul className="divide-y divide-border">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`${basePath}/${r.id}`}
                      className={`flex items-center justify-between px-4 py-2 text-[12.5px] hover:bg-muted/40 ${r.id === log.id ? "bg-muted/60" : ""}`}
                    >
                      <span>{r.action}</span>
                      <span className="text-muted-foreground font-mono text-[11.5px]">
                        {format(parseISO(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
