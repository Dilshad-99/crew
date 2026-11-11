// Team "views": one shared populate shape + the invite-code stripper, so HTTP responses and socket payloads can never disagree about what a team looks like (the code only ever travels in the create response to the leader who made it).
export const TEAM_POPULATE = [
  { path: "leaderId", select: "name" },
  { path: "members", select: "name" },
  { path: "hackathonId", select: "name minTeamSize maxTeamSize" }
];

export function toSafeTeam(team) {
  const { inviteCode, inviteCodeExpiresAt, __v, ...safe } = team.toObject();
  return safe;
}
