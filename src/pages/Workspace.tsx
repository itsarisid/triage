import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/hooks/use-toast";
import { Users, Mail, Send, Trash2, Copy, Loader2, Plus, Bug as BugIcon, LogOut } from "lucide-react";

type Member = { id: string; user_id: string; role: string; created_at: string; name: string; email?: string; avatar_url?: string | null };
type Invite = { id: string; email: string; role: string; status: string; token: string; created_at: string; expires_at: string | null };

export default function Workspace() {
  const { user } = useAuth();
  const { workspaces, workspace, workspaceId, setWorkspaceId, refresh, loading: wsLoading } = useWorkspace();

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [bugCount, setBugCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [sending, setSending] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [creating, setCreating] = useState(false);

  const isAdmin = !!workspace && (workspace.owner_id === user?.id || ["owner", "admin"].includes(workspace.role));

  useEffect(() => { setName(workspace?.name ?? ""); }, [workspace?.id, workspace?.name]);

  const load = async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: memberRows }, { data: inviteRows }, { count }] = await Promise.all([
      supabase.from("workspace_members").select("id,user_id,role,created_at").eq("workspace_id", workspaceId).order("created_at"),
      supabase.from("invitations").select("id,email,role,status,token,created_at,expires_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("bugs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    ]);

    const ids = (memberRows ?? []).map((m) => m.user_id);
    let profiles: any[] = [];
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("user_id,full_name,avatar_url").in("user_id", ids);
      profiles = data ?? [];
    }
    setMembers((memberRows ?? []).map((m) => {
      const p = profiles.find((x) => x.user_id === m.user_id);
      return { ...m, name: p?.full_name || "Teammate", avatar_url: p?.avatar_url ?? null };
    }));
    setInvites((inviteRows ?? []) as Invite[]);
    setBugCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  const saveName = async () => {
    if (!workspaceId || !name.trim()) return;
    setSavingName(true);
    const { error } = await supabase.from("workspaces").update({ name: name.trim() }).eq("id", workspaceId);
    setSavingName(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Workspace renamed" }); await refresh(); }
  };

  const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

  const sendInvite = async () => {
    if (!workspaceId || !user) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Enter a valid email address.", variant: "destructive" });
      return;
    }
    setSending(true);
    const { data, error } = await supabase.from("invitations").insert({
      email,
      role: inviteRole as any,
      invited_by: user.id,
      workspace_id: workspaceId,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }).select("token").single();
    setSending(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setInviteEmail("");
    await navigator.clipboard.writeText(inviteLink(data.token)).catch(() => {});
    toast({ title: "Invite created", description: "Invite link copied to your clipboard." });
    load();
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Invite revoked" }); load(); }
  };

  const removeMember = async (m: Member) => {
    const { error } = await supabase.from("workspace_members").delete().eq("id", m.id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: m.user_id === user?.id ? "You left the workspace" : "Member removed" });
    if (m.user_id === user?.id) await refresh();
    load();
  };

  const createWorkspace = async () => {
    setCreating(true);
    const { data, error } = await supabase.rpc("create_workspace", { _name: newWsName || "My Workspace" });
    setCreating(false);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setNewWsName("");
    await refresh();
    if (data) setWorkspaceId(data as string);
    toast({ title: "Workspace created" });
  };

  const pending = invites.filter((i) => i.status === "pending");

  if (wsLoading || loading) {
    return <AppLayout title="Workspace"><div className="flex justify-center py-16"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div></AppLayout>;
  }

  return (
    <AppLayout title="Workspace">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[16px] font-semibold">{workspace?.name ?? "Workspace"}</h1>
            <p className="text-[12px] text-muted-foreground">
              Private to its members — only these people can see bugs reported here.
            </p>
          </div>
          {workspaces.length > 1 && (
            <Select value={workspaceId ?? undefined} onValueChange={setWorkspaceId}>
              <SelectTrigger className="h-8 w-[220px] text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => <SelectItem key={w.id} value={w.id} className="text-[13px]">{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Users className="h-3 w-3" /> Members</p>
            <p className="text-[20px] font-semibold mt-1">{members.length}</p>
          </div>
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" /> Pending invites</p>
            <p className="text-[20px] font-semibold mt-1">{pending.length}</p>
          </div>
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><BugIcon className="h-3 w-3" /> Shared bugs</p>
            <p className="text-[20px] font-semibold mt-1">{bugCount}</p>
          </div>
        </div>

        {/* Rename */}
        {isAdmin && (
          <section className="rounded-md border border-border p-4 space-y-3">
            <p className="text-[12px] font-medium text-muted-foreground">Workspace name</p>
            <div className="flex gap-2 max-w-md">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px]" />
              <Button size="sm" className="h-8 text-[12px]" onClick={saveName} disabled={savingName || !name.trim()}>
                {savingName && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Save
              </Button>
            </div>
          </section>
        )}

        {/* Invite */}
        {isAdmin && (
          <section className="rounded-md border border-border p-4 space-y-3">
            <p className="text-[12px] font-medium text-muted-foreground">Invite a teammate</p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="h-8 text-[13px] w-full sm:w-72"
              />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="h-8 w-32 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user" className="text-[13px]">Member</SelectItem>
                  <SelectItem value="moderator" className="text-[13px]">Moderator</SelectItem>
                  <SelectItem value="admin" className="text-[13px]">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-[12px]" onClick={sendInvite} disabled={sending}>
                {sending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Send className="mr-1.5 h-3 w-3" />} Create invite
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              An invite link is generated and copied to your clipboard — share it with your teammate. They join after signing in with that email.
            </p>
          </section>
        )}

        {/* Members */}
        <section className="rounded-md border border-border">
          <p className="text-[12px] font-medium text-muted-foreground px-4 py-3 border-b border-border">Members</p>
          <div className="divide-y divide-border">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={m.avatar_url || ""} className="object-cover" />
                    <AvatarFallback className="text-[11px]">{m.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-[13px] truncate">{m.name}{m.user_id === user?.id && " (you)"}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{m.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {workspace?.owner_id === m.user_id && <Badge variant="secondary" className="text-[10px]">Owner</Badge>}
                  {m.user_id === user?.id && workspace?.owner_id !== m.user_id && (
                    <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => removeMember(m)}>
                      <LogOut className="h-3 w-3 mr-1" /> Leave
                    </Button>
                  )}
                  {isAdmin && m.user_id !== user?.id && workspace?.owner_id !== m.user_id && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeMember(m)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pending invites */}
        {isAdmin && (
          <section className="rounded-md border border-border">
            <p className="text-[12px] font-medium text-muted-foreground px-4 py-3 border-b border-border">Pending invites</p>
            {pending.length === 0 ? (
              <p className="text-[12px] text-muted-foreground px-4 py-4">No pending invites.</p>
            ) : (
              <div className="divide-y divide-border">
                {pending.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] truncate">{i.email}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{i.role} · expires {i.expires_at ? new Date(i.expires_at).toLocaleDateString() : "never"}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => { navigator.clipboard.writeText(inviteLink(i.token)); toast({ title: "Invite link copied" }); }}>
                        <Copy className="h-3 w-3 mr-1" /> Copy link
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => revokeInvite(i.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Create workspace */}
        <section className="rounded-md border border-border p-4 space-y-3">
          <p className="text-[12px] font-medium text-muted-foreground">Create another workspace</p>
          <div className="flex gap-2 max-w-md">
            <Input value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="Workspace name" className="h-8 text-[13px]" />
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={createWorkspace} disabled={creating}>
              {creating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Plus className="mr-1.5 h-3 w-3" />} Create
            </Button>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
