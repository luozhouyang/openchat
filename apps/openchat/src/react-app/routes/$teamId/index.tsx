import { createFileRoute, getRouteApi, Navigate } from "@tanstack/react-router";

const teamIdApi = getRouteApi("/$teamId");

export const Route = createFileRoute("/$teamId/")({
  component: TeamIndex,
});

// The parent /$teamId loader already fetched workspaces; reuse it instead of
// issuing a second workspaces request on every visit.
function TeamIndex() {
  const { teamId } = teamIdApi.useParams();
  const data = teamIdApi.useLoaderData();
  const team = data.teams.find((t) => t.id === teamId);
  const first = team?.channels.find(
    (c) => c.member && (c.type === "public" || c.type === "private"),
  );
  if (first) {
    return <Navigate to="/$teamId/c/$channelId" params={{ teamId, channelId: first.id }} replace />;
  }
  return <div className="p-8 text-zinc-500">尚未加入任何频道</div>;
}
