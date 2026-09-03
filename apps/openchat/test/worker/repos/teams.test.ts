import { expect, test } from "vite-plus/test";
import { env } from "cloudflare:test";
import { getDb } from "../../../src/worker/db/client.ts";
import {
  createTeam,
  getTeam,
  listTeamsForUser,
  getTeamMember,
  addTeamMember,
  removeTeamMember,
  countTeamAdmins,
} from "../../../src/worker/db/repos/teams.ts";

const db = getDb(env.DB);

test("team repo roundtrip", async () => {
  const team = await createTeam(db, {
    id: "team-roundtrip-1",
    name: "roundtrip-team-1",
    displayName: "Roundtrip Team 1",
    type: "open",
    inviteCode: "invite-roundtrip-1",
    creatorId: "user-a",
  });
  expect(team?.name).toBe("roundtrip-team-1");
  expect(team?.inviteCode).toBe("invite-roundtrip-1");

  const fetched = await getTeam(db, "team-roundtrip-1");
  expect(fetched?.displayName).toBe("Roundtrip Team 1");

  const mine = await listTeamsForUser(db, "user-a");
  expect(mine).toHaveLength(1);
  expect(mine[0]?.roles).toBe("team_admin");

  const creatorMember = await getTeamMember(db, "team-roundtrip-1", "user-a");
  expect(creatorMember?.roles).toBe("team_admin");

  await addTeamMember(db, { teamId: "team-roundtrip-1", userId: "user-b", roles: "team_user" });
  expect((await getTeamMember(db, "team-roundtrip-1", "user-b"))?.roles).toBe("team_user");
  expect(await countTeamAdmins(db, "team-roundtrip-1")).toBe(1);

  await removeTeamMember(db, "team-roundtrip-1", "user-b");
  expect(await getTeamMember(db, "team-roundtrip-1", "user-b")).toBeNull();
});
