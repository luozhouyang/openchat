import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePermissions(): string[] {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
  });
  return data?.user.permissions ?? [];
}
