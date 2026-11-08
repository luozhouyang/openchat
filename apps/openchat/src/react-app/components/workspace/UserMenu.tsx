import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { appClient } from "@/app-client";
import { api } from "@/lib/api";
import { usePresenceStore, useStatus } from "@/stores/presence";
import { useMe } from "@/hooks/use-me";
import { resetSessionProbe } from "@/lib/session-guard";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDownIcon, CircleIcon, LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";

const STATUSES = ["online", "away", "dnd", "offline"] as const;
type PresenceStatus = (typeof STATUSES)[number];

export function UserMenu() {
  const { t } = useTranslation();
  const user = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useStatus(user?.id);

  if (!user) {
    return null;
  }

  async function setStatus(next: PresenceStatus) {
    try {
      await api.status.put(user!.id, { status: next });
      usePresenceStore.setState((state) => ({
        byId: { ...state.byId, [user!.id]: { status: next, at: Date.now() } },
      }));
    } catch {
      // Status is cosmetic; a failed write keeps the previous value.
    }
  }
  const displayName = user.nickname ?? user.username ?? user.email;
  const initials = displayName.slice(0, 2).toUpperCase();
  const avatar = user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
      {initials}
    </div>
  );

  async function signOut() {
    setOpen(false);
    try {
      await appClient.auth.signOut();
      resetSessionProbe();
      queryClient.clear();
      await navigate({ to: "/auth/login" });
    } catch {
      resetSessionProbe();
      queryClient.clear();
    }
  }

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  aria-label={displayName}
                  className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                >
                  {avatar}
                  <div className="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">{displayName}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              }
            />
            <DropdownMenuContent align="end" side="top" className="w-(--sidebar-width)">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="p-0 font-normal text-popover-foreground">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    {avatar}
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{displayName}</span>
                      <span className="truncate text-xs">{user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <CircleIcon className="size-2 fill-current" />
                  {t("workspace.status")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={status}
                    onValueChange={(value) => void setStatus(value as PresenceStatus)}
                  >
                    {STATUSES.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {t(`presence.${value}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem render={<Link to="/settings" />}>
                <SettingsIcon />
                {t("workspace.settings")}
              </DropdownMenuItem>
              {user.role === "admin" && (
                <DropdownMenuItem render={<Link to="/admin" />}>
                  <ShieldIcon />
                  {t("admin.console")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()}>
                <LogOutIcon />
                {t("workspace.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
