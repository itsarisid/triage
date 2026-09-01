import { LayoutDashboard, Bug, BarChart3, ScrollText, Activity, History, PieChart, Settings, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { StackedLogo } from "./StackedLogo";
import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Bug, label: "All Bugs", path: "/bugs" },
  { icon: BarChart3, label: "Analytics", path: "/analytics" },
  { icon: ScrollText, label: "Logs", path: "/logs" },
  { icon: Activity, label: "Log Analytics", path: "/logs/analytics" },
  { icon: History, label: "Activity", path: "/activity" },
  { icon: PieChart, label: "Activity Analytics", path: "/activity/analytics" },
];

export function SidebarContent({ collapsed = false, onNavigate, onToggle }: { collapsed?: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const isActive = (path: string) =>
    location.pathname === path || (path !== "/" && location.pathname.startsWith(path));

  return (
    <>
      {/* Workspace header */}
      <div className={cn("flex items-center h-11 border-b border-sidebar-border", collapsed ? "justify-center px-0" : "justify-between px-3")}>
        <div className="flex items-center gap-2 min-w-0">
          <StackedLogo size={16} color="currentColor" />
          {!collapsed && (
            <span className="font-bold uppercase tracking-[0.08em] text-[14px] text-sidebar-accent-foreground">
              Triage
            </span>
          )}
        </div>
        {onToggle && !collapsed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-6 w-6 text-sidebar-foreground hover:bg-sidebar-accent"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {onToggle && collapsed && (
        <div className="flex justify-center pt-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-1.5 px-1.5 space-y-px">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors",
              collapsed && "justify-center px-0",
              isActive(item.path)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Bottom actions (VS Code style): Settings gear + account */}
      <div className="border-t border-sidebar-border py-1.5 px-1.5 space-y-px">
        <Link
          to="/settings"
          onClick={onNavigate}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors",
            collapsed && "justify-center px-0",
            isActive("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        <div className={cn("flex items-center gap-2 px-1 pt-1", collapsed && "flex-col px-0")}>
          <Avatar className="h-5 w-5">
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-[9px] leading-none">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="text-[12px] text-sidebar-foreground truncate flex-1">
              {profile?.full_name || "User"}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            title="Sign out"
            className="text-sidebar-foreground hover:bg-sidebar-accent h-6 w-6"
          >
            <LogOut className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0 transition-[width] duration-200",
        collapsed ? "w-12" : "w-52"
      )}
    >
      <div className="flex flex-col flex-1 overflow-hidden">
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      </div>
    </aside>
  );
}
