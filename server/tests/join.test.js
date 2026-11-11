// THE acceptance gate: 50 parallel joins hit the last seat of a team — exactly ONE may win, the other 49 must fail with clean 409s, and the database must stay consistent. Also proves leader-only permissions, invite expiry, idempotency replay, the one-team-per-hackathon rule, and leadership succession.
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import JoinRequest from "../src/models/JoinRequest.js";
import AuditLog from "../src/models/AuditLog.js";
import Idempotency from "../src/models/Idempotency.js";
import Hackathon from "../src/models/Hackathon.js";
import { JWT_SECRET } from "../src/middleware/auth.js";

jest.setTimeout(60000);

const MONGO_URI = process.env.TEST_MONGODB_URI || "mongodb://localhost:27017/crew_test";

let hackathon;
let userCounter = 0;

// Tests create users directly with one shared pre-hashed password and sign JWTs exactly like login does — the race is what's under test, not bcrypt speed
let sharedHash;

async function makeUser(name) {
  const email = `u${userCounter++}.${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@test.dev`;
  const user = await User.create({
    name,
    email,
    password: sharedHash,
    skills: ["jest"],
    timezone: "UTC",
    role: "user"
  });
  const token = jwt.sign({ _id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

function authGet(token) {
  return request(app).get("/api/teams").set("Authorization", `Bearer ${token}`);
}

async function createTeamViaApi(leader, name, idempotencyKey = crypto.randomUUID()) {
  return request(app)
    .post("/api/teams")
    .set("Authorization", `Bearer ${leader.token}`)
    .send({ hackathonId: String(hackathon._id), name, idempotencyKey });
}

async function joinViaCode(user, inviteCode, idempotencyKey = crypto.randomUUID()) {
  return request(app)
    .post("/api/teams/join")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ inviteCode, idempotencyKey });
}

async function requestToJoin(user, teamId, idempotencyKey) {
  return request(app)
    .post(`/api/teams/${teamId}/requests`)
    .set("Authorization", `Bearer ${user.token}`)
    .send(idempotencyKey ? { idempotencyKey } : {});
}

beforeAll(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.db.dropDatabase();
  // The unique indexes ARE the race guarantee — build them explicitly, never trust they exist
  await Promise.all([Team.syncIndexes(), JoinRequest.syncIndexes(), Idempotency.syncIndexes()]);
  sharedHash = await (await import("bcryptjs")).default.hash("password123", 10);
  hackathon = await Hackathon.create({ name: "Race Test Hackathon", minTeamSize: 2, maxTeamSize: 5 });
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe("race: 50 parallel joins for the last seat", () => {
  test("exactly one join wins, 49 fail cleanly, DB stays consistent", async () => {
    const leader = await makeUser("Race Leader");
    const createRes = await createTeamViaApi(leader, "Last Seat Racers");
    expect(createRes.status).toBe(201);
    const teamId = createRes.body.team._id;
    const inviteCode = createRes.body.team.inviteCode;

    // Fill 3 seats (leader + 3 = 4 of 5) so exactly ONE seat is left
    for (let i = 0; i < 3; i++) {
      const filler = await makeUser(`Race Filler ${i}`);
      const res = await joinViaCode(filler, inviteCode);
      expect(res.status).toBe(200);
    }

    // 50 racers hit the last seat in parallel
    const racers = [];
    for (let i = 0; i < 50; i++) {
      racers.push(await makeUser(`Racer ${i}`));
    }
    const results = await Promise.all(racers.map((racer) => joinViaCode(racer, inviteCode)));

    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status !== 200);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(49);
    // Failures must be CLEAN 409s — a single 500 here would mean a race leaked
    losers.forEach((r) => {
      expect(r.status).toBe(409);
      expect(r.body.status).toBe(false);
    });

    // Database consistency: full, no duplicates, exactly one winner recorded
    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(5);
    expect(team.members).toHaveLength(5);
    expect(new Set(team.members.map(String)).size).toBe(5);

    // Every losing racer must be in NO team of this hackathon
    const loserIds = racers.filter((_, i) => results[i].status !== 200).map((r) => r.user._id);
    const strayMemberships = await Team.countDocuments({ hackathonId: hackathon._id, members: { $in: loserIds } });
    expect(strayMemberships).toBe(0);

    // Audit trail: 3 fillers + 1 winner joined, team created once
    const joinedAudits = await AuditLog.countDocuments({ teamId, action: "member_joined" });
    expect(joinedAudits).toBe(4);
    const createdAudits = await AuditLog.countDocuments({ teamId, action: "team_created" });
    expect(createdAudits).toBe(1);
  });
});

describe("idempotency", () => {
  test("same idempotency key twice: joins once and the retry replays the original result", async () => {
    const leader = await makeUser("Idem Leader");
    const joiner = await makeUser("Idem Joiner");
    const createRes = await createTeamViaApi(leader, "Idem Team");
    const inviteCode = createRes.body.team.inviteCode;
    const key = crypto.randomUUID();

    const first = await joinViaCode(joiner, inviteCode, key);
    expect(first.status).toBe(200);

    const retry = await joinViaCode(joiner, inviteCode, key);
    expect(retry.status).toBe(200);
    expect(retry.body.team._id).toBe(first.body.team._id);

    const team = await Team.findById(createRes.body.team._id);
    expect(team.memberCount).toBe(2);
    expect(team.members.filter((m) => m.equals(joiner.user._id))).toHaveLength(1);
  });

  test("same idempotency key twice on create-team: only one team exists", async () => {
    const leader = await makeUser("Idem Create Leader");
    const key = crypto.randomUUID();

    const first = await createTeamViaApi(leader, "One Team Only", key);
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post("/api/teams")
      .set("Authorization", `Bearer ${leader.token}`)
      .send({ hackathonId: String(hackathon._id), name: "One Team Only", idempotencyKey: key });
    expect(retry.status).toBe(201);
    expect(retry.body.team._id).toBe(first.body.team._id);

    expect(await Team.countDocuments({ name: "One Team Only" })).toBe(1);
  });
});

describe("leader-only permissions", () => {
  let leader, member, outsider, teamId, joinRequestId;

  beforeEach(async () => {
    leader = await makeUser("Perm Leader");
    member = await makeUser("Perm Member");
    outsider = await makeUser("Perm Outsider");
    const createRes = await createTeamViaApi(leader, "Permission Team");
    expect(createRes.status).toBe(201);
    teamId = createRes.body.team._id;
    const joinRes = await joinViaCode(member, createRes.body.team.inviteCode);
    expect(joinRes.status).toBe(200);

    const requester = await makeUser("Perm Requester");
    const reqRes = await requestToJoin(requester, teamId);
    expect(reqRes.status).toBe(201);
    joinRequestId = reqRes.body.request._id;
  });

  test("a regular member cannot accept a join request", async () => {
    const res = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/accept`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only the team leader/i);
    expect((await JoinRequest.findById(joinRequestId)).status).toBe("pending");
  });

  test("a regular member cannot decline a join request", async () => {
    const res = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/decline`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(403);
  });

  test("an outsider cannot remove a member", async () => {
    const res = await request(app)
      .delete(`/api/teams/${teamId}/members/${String(member.user._id)}`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(2);
  });

  test("a regular member cannot remove another member", async () => {
    const res = await request(app)
      .delete(`/api/teams/${teamId}/members/${String(leader.user._id)}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(403);
  });

  test("the leader can accept, and the member is added exactly once", async () => {
    const res = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/accept`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(res.status).toBe(200);

    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(3);
    expect(team.members).toHaveLength(3);
    const request_ = await JoinRequest.findById(joinRequestId);
    expect(request_.status).toBe("accepted");
    expect(await AuditLog.countDocuments({ teamId, action: "request_accepted" })).toBe(1);
  });

  test("the leader can decline", async () => {
    const res = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/decline`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(res.status).toBe(200);
    expect((await JoinRequest.findById(joinRequestId)).status).toBe("declined");
    expect(await AuditLog.countDocuments({ teamId, action: "request_declined" })).toBe(1);
  });

  test("double accept is a clean 409 — the member is never added twice", async () => {
    const first = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/accept`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/teams/${teamId}/requests/${joinRequestId}/accept`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(second.status).toBe(409);

    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(3);
    expect(team.members).toHaveLength(3);
  });

  test("a second pending join request for the same team is a clean 409 (partial unique index)", async () => {
    const requester = await JoinRequest.findOne({ _id: joinRequestId });
    const again = await requestToJoin(
      { token: jwt.sign({ _id: requester.userId, email: "x@t.dev", role: "user" }, JWT_SECRET, { expiresIn: "1h" }) },
      teamId
    );
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/pending request/i);
  });
});

describe("invite code expiry", () => {
  test("an expired invite code is rejected and the seat count is untouched", async () => {
    const leader = await makeUser("Expiry Leader");
    const joiner = await makeUser("Expiry Joiner");
    const createRes = await createTeamViaApi(leader, "Expiry Team");
    const teamId = createRes.body.team._id;

    await Team.updateOne({ _id: teamId }, { $set: { inviteCodeExpiresAt: new Date(Date.now() - 60 * 1000) } });

    const res = await joinViaCode(joiner, createRes.body.team.inviteCode);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/expired/i);

    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(1);
    expect(team.members).toHaveLength(1);
  });
});

describe("one team per hackathon", () => {
  test("joining a second team in the same hackathon fails cleanly", async () => {
    const leaderA = await makeUser("One Leader A");
    const leaderB = await makeUser("One Leader B");
    const user = await makeUser("One Team User");

    const teamA = await createTeamViaApi(leaderA, "First Team");
    const teamB = await createTeamViaApi(leaderB, "Second Team");
    expect(teamA.status).toBe(201);
    expect(teamB.status).toBe(201);

    const joinA = await joinViaCode(user, teamA.body.team.inviteCode);
    expect(joinA.status).toBe(200);

    const joinB = await joinViaCode(user, teamB.body.team.inviteCode);
    expect(joinB.status).toBe(409);
    expect(joinB.body.message).toMatch(/already have a team/i);

    const teamBDoc = await Team.findById(teamB.body.team._id);
    expect(teamBDoc.memberCount).toBe(1);
    expect(teamBDoc.members).toHaveLength(1);
  });

  test("parallel joins of the same user to two teams: exactly one wins", async () => {
    const leaderA = await makeUser("Par Leader A");
    const leaderB = await makeUser("Par Leader B");
    const user = await makeUser("Par Racer");

    const teamA = await createTeamViaApi(leaderA, "Parallel Team A");
    const teamB = await createTeamViaApi(leaderB, "Parallel Team B");

    const [resA, resB] = await Promise.all([
      joinViaCode(user, teamA.body.team.inviteCode),
      joinViaCode(user, teamB.body.team.inviteCode)
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const memberships = await Team.find({ hackathonId: hackathon._id, members: user.user._id });
    expect(memberships).toHaveLength(1);
  });
});

describe("leaving: succession and deletion", () => {
  test("leader leaving passes leadership to the oldest remaining member", async () => {
    const leader = await makeUser("Succession Leader");
    const first = await makeUser("Succession First");
    const second = await makeUser("Succession Second");

    const createRes = await createTeamViaApi(leader, "Succession Team");
    const teamId = createRes.body.team._id;
    expect((await joinViaCode(first, createRes.body.team.inviteCode)).status).toBe(200);
    expect((await joinViaCode(second, createRes.body.team.inviteCode)).status).toBe(200);

    const leaveRes = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(leaveRes.status).toBe(200);

    const team = await Team.findById(teamId);
    expect(team.leaderId.equals(first.user._id)).toBe(true); // oldest remaining member
    expect(team.memberCount).toBe(2);
    expect(team.members.map(String)).toEqual([String(first.user._id), String(second.user._id)]);
    expect(await AuditLog.countDocuments({ teamId, action: "leadership_transferred" })).toBe(1);
  });

  test("a regular member leaving decrements the count and writes an audit row", async () => {
    const leader = await makeUser("Leave Leader");
    const member = await makeUser("Leave Member");
    const createRes = await createTeamViaApi(leader, "Leave Team");
    const teamId = createRes.body.team._id;
    expect((await joinViaCode(member, createRes.body.team.inviteCode)).status).toBe(200);

    const res = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(200);

    const team = await Team.findById(teamId);
    expect(team.memberCount).toBe(1);
    expect(team.members.map(String)).toEqual([String(leader.user._id)]);
    expect(await AuditLog.countDocuments({ teamId, action: "member_left" })).toBe(1);
  });

  test("the last member leaving deletes the team and its pending requests", async () => {
    const leader = await makeUser("Delete Leader");
    const createRes = await createTeamViaApi(leader, "Doomed Team");
    const teamId = createRes.body.team._id;
    expect(createRes.status).toBe(201);

    const res = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    expect(await Team.findById(teamId)).toBeNull();
    expect(await JoinRequest.countDocuments({ teamId })).toBe(0);
    expect(await AuditLog.countDocuments({ teamId, action: "team_deleted" })).toBe(1);
  });
});
