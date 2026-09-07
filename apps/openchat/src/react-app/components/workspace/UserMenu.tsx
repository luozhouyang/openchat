import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { appClient } from "@/app-client";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";

export function UserMenu() {
  const { t } = useTranslation();
  const user = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  if (!user) {
    return null;
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
    await appClient.auth.signOut();
    resetSessionProbe();
    queryClient.clear();
    setOpen(false);
    await navigate({ to: "/auth/login" });
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
