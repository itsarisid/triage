import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Workspace = { id: string; name: string; owner_id: string; role: string };

type WorkspaceContextValue = {
  workspaces: Workspace[];
  workspaceId: string | null;
  workspace: Workspace | null;
  loading: boolean;
  setWorkspaceId: (id: string) => void;
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const STORAGE_KEY = "triage.workspace";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setWorkspaceIdState(null);
      setLoading(false);
      return;
    }
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, owner_id)")
      .eq("user_id", user.id);

    let list: Workspace[] = (memberships ?? [])
      .map((m: any) => m.workspaces && ({ id: m.workspaces.id, name: m.workspaces.name, owner_id: m.workspaces.owner_id, role: m.role }))
      .filter(Boolean);

    // Every user needs at least one workspace
    if (list.length === 0) {
      const { data: newId } = await supabase.rpc("create_workspace", { _name: "My Workspace" });
      if (newId) {
        const { data: ws } = await supabase.from("workspaces").select("id, name, owner_id").eq("id", newId).maybeSingle();
        if (ws) list = [{ ...ws, role: "owner" }];
      }
    }

    list.sort((a, b) => a.name.localeCompare(b.name));
    setWorkspaces(list);

    const stored = localStorage.getItem(STORAGE_KEY);
    const next = list.find((w) => w.id === stored)?.id ?? list[0]?.id ?? null;
    setWorkspaceIdState(next);
    if (next) localStorage.setItem(STORAGE_KEY, next);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const setWorkspaceId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setWorkspaceIdState(id);
  };

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  return (
    <WorkspaceContext.Provider value={{ workspaces, workspaceId, workspace, loading, setWorkspaceId, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
