import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Send, Paperclip, Download, Trash2, Upload } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Tables, Enums } from "@/integrations/supabase/types";
import { formatDistanceToNow, format } from "date-fns";
import {
  canTransition, transitionAction, reopenTarget, isResolvedStatus,
  STATUS_LABEL, type BugStatus,
} from "@/lib/bugLifecycle";

type BugRow = Tables<"bugs">;
type CommentRow = Tables<"comments">;
type ActivityRow = Tables<"activity_log">;
type AttachmentRow = Tables<"attachments">;

function formatBytes(n: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function actionLabel(a: string) {
  return a.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

const statusFlow: Enums<"bug_status">[] = ["new", "assigned", "in_progress", "testing", "resolved", "closed"];


export default function BugDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [bug, setBug] = useState<BugRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchBug = async () => {
    if (!id) return;
    const { data } = await supabase.from("bugs").select("*").eq("id", id).single();
    setBug(data);
    setLoading(false);
  };

  const fetchComments = async () => {
    if (!id) return;
    const { data } = await supabase
      .from("comments").select("*").eq("bug_id", id).order("created_at", { ascending: true });
    setComments(data || []);
    const userIds = [...new Set((data || []).map(c => c.user_id))];
    if (userIds.length > 0) {
      const { data: profileData } = await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds);
      const map: Record<string, string> = {};
      (profileData || []).forEach(p => { map[p.user_id] = p.full_name; });
      setProfiles(prev => ({ ...prev, ...map }));
    }
  };

  const loadProfiles = async (userIds: string[]) => {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    const { data } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
    const map: Record<string, string> = {};
    (data || []).forEach((p) => { map[p.user_id] = p.full_name; });
    setProfiles((prev) => ({ ...prev, ...map }));
  };

  const fetchActivity = async () => {
    if (!id) return;
    const { data } = await supabase
      .from("activity_log").select("*").eq("bug_id", id).order("created_at", { ascending: false });
    setActivity(data || []);
    await loadProfiles((data || []).map((a) => a.user_id));
  };

  const fetchAttachments = async () => {
    if (!id) return;
    const { data } = await supabase
      .from("attachments").select("*").eq("bug_id", id).order("created_at", { ascending: false });
    setAttachments(data || []);
    await loadProfiles((data || []).map((a) => a.user_id));
  };

  const uploadAttachment = async (file: File) => {
    if (!user || !id) return;
    setUploading(true);
    const path = `${user.id}/${id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("bug-attachments").upload(path, file);
    if (upErr) {
      toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
    } else {
      const { error } = await supabase.from("attachments").insert({
        bug_id: id, user_id: user.id, file_name: file.name, file_path: path,
        file_size: file.size, mime_type: file.type,
      });
      if (error) toast({ title: "Failed to save attachment", description: error.message, variant: "destructive" });
      else {
        await supabase.from("activity_log").insert({
          bug_id: id, user_id: user.id, action: "attachment_added", new_value: file.name,
        });
        toast({ title: "Attachment uploaded" });
        fetchAttachments();
        fetchActivity();
      }
    }
    setUploading(false);
  };

  const downloadAttachment = async (a: AttachmentRow) => {
    const { data, error } = await supabase.storage.from("bug-attachments").createSignedUrl(a.file_path, 60);
    if (error || !data) {
      toast({ title: "Could not open file", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const deleteAttachment = async (a: AttachmentRow) => {
    await supabase.storage.from("bug-attachments").remove([a.file_path]);
    const { error } = await supabase.from("attachments").delete().eq("id", a.id);
    if (error) toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    else { toast({ title: "Attachment removed" }); fetchAttachments(); }
  };

  useEffect(() => {
    fetchBug();
    fetchComments();
    fetchActivity();
    fetchAttachments();
    const channel = supabase
      .channel(`bug-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `bug_id=eq.${id}` }, () => fetchComments())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bugs", filter: `id=eq.${id}` }, () => { fetchBug(); fetchActivity(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `bug_id=eq.${id}` }, () => fetchActivity())
      .on("postgres_changes", { event: "*", schema: "public", table: "attachments", filter: `bug_id=eq.${id}` }, () => fetchAttachments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const updateStatus = async (newStatus: Enums<"bug_status">) => {
    if (!bug || !user) return;
    const from = bug.status as BugStatus;
    if (!canTransition(from, newStatus)) {
      toast({
        title: "Transition not allowed",
        description: `${STATUS_LABEL[from]} → ${STATUS_LABEL[newStatus]} is not part of the bug lifecycle.`,
        variant: "destructive",
      });
      return;
    }
    const action = transitionAction(from, newStatus);
    const { error } = await supabase.from("bugs").update({ status: newStatus }).eq("id", bug.id);
    if (error) {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    } else {
      await supabase.from("activity_log").insert({
        bug_id: bug.id, user_id: user.id, action,
        old_value: bug.status, new_value: newStatus,
      });
      toast({
        title: action === "reopen" ? "Bug reopened"
          : action === "close" ? "Bug closed"
          : action === "resolve" ? "Bug marked resolved"
          : `Status updated to ${STATUS_LABEL[newStatus]}`,
      });
    }
  };


  const addComment = async () => {
    if (!newComment.trim() || !user || !bug) return;
    setSubmittingComment(true);
    const { error } = await supabase.from("comments").insert({
      bug_id: bug.id, user_id: user.id, content: newComment.trim(),
    });
    if (error) toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    else setNewComment("");
    setSubmittingComment(false);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!bug) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <p className="text-[13px] text-muted-foreground">Bug not found</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/")} className="h-7 text-[12px]">
            Back to Dashboard
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-4 md:px-6 h-11 border-b border-border shrink-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-7 w-7">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono text-[12px] text-muted-foreground">{bug.tracking_id}</span>
          <StatusBadge status={bug.status} />
          <SeverityBadge severity={bug.severity} />
        </div>

        <div className="flex-1 overflow-auto">
          <div className="flex flex-col lg:flex-row">
            {/* Main content */}
            <div className="flex-1 min-w-0 border-r border-border">
              {/* Title */}
              <div className="px-4 md:px-6 py-4 border-b border-border">
                <h1 className="text-base font-medium">{bug.title}</h1>
              </div>

              {/* Description */}
              <div className="px-4 md:px-6 py-4 border-b border-border">
                <p className="text-[12px] text-muted-foreground mb-2 font-medium">Description</p>
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{bug.description || "No description"}</p>
              </div>

              {bug.steps_to_reproduce && (
                <div className="px-4 md:px-6 py-4 border-b border-border">
                  <p className="text-[12px] text-muted-foreground mb-2 font-medium">Steps to Reproduce</p>
                  <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{bug.steps_to_reproduce}</p>
                </div>
              )}

              {(bug.expected_behavior || bug.actual_behavior) && (
                <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
                  {bug.expected_behavior && (
                    <div className="px-4 md:px-6 py-4 md:border-r border-border">
                      <p className="text-[12px] text-muted-foreground mb-2 font-medium">Expected</p>
                      <p className="text-[13px]">{bug.expected_behavior}</p>
                    </div>
                  )}
                  {bug.actual_behavior && (
                    <div className="px-4 md:px-6 py-4">
                      <p className="text-[12px] text-muted-foreground mb-2 font-medium">Actual</p>
                      <p className="text-[13px]">{bug.actual_behavior}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Comments / History / Attachments */}
              <div className="px-4 md:px-6 py-4">
                <Tabs defaultValue="comments">
                  <TabsList className="h-8">
                    <TabsTrigger value="comments" className="text-[12px] h-6">Comments · {comments.length}</TabsTrigger>
                    <TabsTrigger value="history" className="text-[12px] h-6">History · {activity.length}</TabsTrigger>
                    <TabsTrigger value="files" className="text-[12px] h-6">Attachments · {attachments.length}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="mt-4">
                    <div className="space-y-3">
                      {comments.length === 0 && (
                        <p className="text-[12px] text-muted-foreground">No comments yet.</p>
                      )}
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-2xs font-medium text-muted-foreground">
                              {(profiles[c.user_id] || "U").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium">{profiles[c.user_id] || "User"}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-[13px] mt-0.5 leading-relaxed">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Textarea
                        placeholder="Leave a comment..."
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        className="text-[13px] min-h-[60px] resize-none"
                      />
                      <Button
                        onClick={addComment}
                        disabled={!newComment.trim() || submittingComment}
                        size="sm"
                        className="shrink-0 self-end h-8"
                      >
                        {submittingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="history" className="mt-4">
                    {activity.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No recorded history for this bug yet.</p>
                    ) : (
                      <ol className="relative border-l border-border pl-4 space-y-4">
                        {activity.map((a) => (
                          <li key={a.id} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium">{actionLabel(a.action)}</span>
                              <span className="text-[11px] text-muted-foreground">
                                by {profiles[a.user_id] || "User"} · {format(new Date(a.created_at), "MMM dd, yyyy HH:mm")}
                              </span>
                            </div>
                            {(a.old_value || a.new_value) && (
                              <p className="text-[12px] text-muted-foreground mt-0.5">
                                {a.old_value && <span className="line-through">{a.old_value}</span>}
                                {a.old_value && a.new_value && <span className="mx-1">→</span>}
                                {a.new_value && <span className="text-foreground">{a.new_value}</span>}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </TabsContent>

                  <TabsContent value="files" className="mt-4">
                    <div className="space-y-2">
                      {attachments.length === 0 && (
                        <p className="text-[12px] text-muted-foreground">No attachments yet.</p>
                      )}
                      {attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 border border-border rounded-md px-3 py-2">
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] truncate">{a.file_name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatBytes(a.file_size || 0)} · {profiles[a.user_id] || "User"} ·{" "}
                              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadAttachment(a)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {user?.id === a.user_id && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteAttachment(a)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer border border-border rounded-md px-3 h-8 hover:bg-muted transition-colors">
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {uploading ? "Uploading..." : "Upload file"}
                        <input
                          type="file"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadAttachment(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

            </div>

            {/* Right sidebar */}
            <div className="w-full lg:w-64 shrink-0">
              {/* Lifecycle state machine */}
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[12px] text-muted-foreground mb-2 font-medium">Lifecycle</p>
                <div className="flex flex-wrap gap-1">
                  {statusFlow.map((status) => {
                    const current = bug.status === status;
                    const allowed = canTransition(bug.status as BugStatus, status);
                    return (
                      <Button
                        key={status}
                        variant={current ? "secondary" : "ghost"}
                        size="sm"
                        disabled={current || !allowed}
                        title={current ? "Current state" : allowed ? `Move to ${STATUS_LABEL[status]}` : "Not allowed from current state"}
                        onClick={() => updateStatus(status)}
                        className="h-6 text-[11px] px-2"
                      >
                        {STATUS_LABEL[status]}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex gap-1 mt-2">
                  {isResolvedStatus(bug.status) ? (
                    <Button
                      size="sm" variant="outline" className="h-6 text-[11px] px-2"
                      onClick={() => updateStatus(reopenTarget(bug.status as BugStatus))}
                    >
                      Reopen
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="outline" className="h-6 text-[11px] px-2"
                      onClick={() => updateStatus("closed")}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </div>


              {/* Properties */}
              <div className="px-4 py-3 space-y-3 text-[13px]">
                <div>
                  <p className="text-[12px] text-muted-foreground mb-0.5">Environment</p>
                  <p>{bug.environment || "—"}</p>
                </div>
                <div>
                  <p className="text-[12px] text-muted-foreground mb-0.5">Created</p>
                  <p>{formatDistanceToNow(new Date(bug.created_at), { addSuffix: true })}</p>
                </div>
                <div>
                  <p className="text-[12px] text-muted-foreground mb-0.5">Updated</p>
                  <p>{formatDistanceToNow(new Date(bug.updated_at), { addSuffix: true })}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
