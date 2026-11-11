// Realtime acceptance gates: a join announced over HTTP must arrive as a memberJoined event on the hackathon board WITHOUT any polling, every controller action must leave an audit row, suggestions must never recommend someone already in a team, and non-members must be locked out of the team's audit feed. Socket auth and room membership are enforced server-side — a bad token can't even connect, and a non-member can't join a team room.
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import http from "http";
import mongoose from "mongoose";
import { io as clientIo } from "socket.io-client";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Team from "../src/models/Team.js";
import JoinRequest from "../src/models/JoinRequest.js";
import AuditLog from "../src/models/AuditLog.js";
import Idempotency from "../src/models/Idempotency.js";
import Hackathon from "../src/models/Hackathon.js";
import { JWT_SECRET } from "../src/middleware/auth.js";
import { initializeSocket, getIO } from "../src/realtime/io.js";

jest.setTimeout(60000);

// Separate DB from join.test.js — Jest runs test files in parallel workers, and two suites sharing one database would sabotage each other
const MONGO_URI = process.env.TEST_MONGODB_URI_RT || "mongodb://localhost:27017/crew_test_rt";

let hackathon;
let httpServer;
let userCounter = 0;
let sharedHash;

// Neutral default skills [] — only fixtures that explicitly pass skills should influence suggestion rankings, earlier tests' leftovers must not crowd the top-10 cut
async function makeUser(name, skills = [], timezone = "UTC") {
  const email = `u${userCounter++}.${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@test.dev`;
  const user = await User.create({
    name,
    email,
    password: sharedHash,
    skills,
    timezone,
    role: "user"
  });
  const token = jwt.sign({ _id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

function authPost(token, path, body) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}

async function createTeamViaApi(leader, name, idempotencyKey = crypto.randomUUID()) {
  return authPost(leader.token, "/api/teams", {
    hackathonId: String(hackathon._id),
    name,
    idempotencyKey
  });
}

// A real socket.io client connected to the test HTTP server with the same JWT the REST API uses
function connectClient(token) {
  return clientIo(`http://127.0.0.1:${httpServer.address().port}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false
  });
}

// Subscribes to a room and resolves once the ack confirms it — mirrors what the React board page does on connect
function subscribe(socket, event, roomId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} subscribe timed out`)), 5000);
    socket.emit(event, roomId, (ack) => {
      clearTimeout(timeout);
      ack?.status ? resolve() : reject(new Error(ack?.message || "subscribe rejected"));
    });
  });
}

// Collects the next event of a type into a promise — the test's whole job is waiting for the push to arrive
function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} never arrived`)), 5000);
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all([Team.syncIndexes(), JoinRequest.syncIndexes(), Idempotency.syncIndexes()]);
  sharedHash = await (await import("bcryptjs")).default.hash("password123", 10);
  hackathon = await Hackathon.create({ name: "Realtime Test Hackathon", minTeamSize: 2, maxTeamSize: 5 });

  // Boot Express and Socket.io on ONE ephemeral server — the exact production topology, just a random port
  httpServer = http.createServer(app);
  initializeSocket(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  getIO()?.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

describe("socket auth", () => {
  test("a bad token is rejected at the handshake — no connection, no rooms", async () => {
    const socket = connectClient("not-a-real-jwt");
    const error = await new Promise((resolve) => socket.on("connect_error", resolve));
    expect(error).toBeTruthy();
    socket.close();
  });

  test("a non-member cannot subscribe to a team room", async () => {
    const leader = await makeUser("Room Leader");
    const res = await createTeamViaApi(leader, "Room Guards");
    const outsider = await makeUser("Room Outsider");
    const socket = connectClient(outsider.token);
    await new Promise((resolve) => socket.on("connect", resolve));

    const ack = await new Promise((resolve) =>
      socket.emit("team:subscribe", res.body.team._id, resolve)
    );
    expect(ack.status).toBe(false);
    socket.close();
  });
});

describe("live board events", () => {
  test("a join over HTTP pushes memberJoined to every subscribed board, no refresh needed", async () => {
    const leader = await makeUser("Board Leader");
    const created = await createTeamViaApi(leader, "Board Watched");
    expect(created.status).toBe(201);

    const joiner = await makeUser("Board Joiner");
    const watcher = await makeUser("Board Watcher");
    const watcherSocket = connectClient(watcher.token);
    await new Promise((resolve) => watcherSocket.on("connect", resolve));
    await subscribe(watcherSocket, "hackathon:subscribe", String(hackathon._id));

    // Watch FIRST, then trigger the HTTP join — proves it's a push, not a coincidence of ordering
    const memberJoined = nextEvent(watcherSocket, "memberJoined");
    const joined = await authPost(joiner.token, "/api/teams/join", {
      inviteCode: created.body.team.inviteCode,
      idempotencyKey: crypto.randomUUID()
    });
    expect(joined.status).toBe(200);

    const payload = await memberJoined;
    expect(String(payload.teamId)).toBe(String(created.body.team._id));
    expect(String(payload.userId)).toBe(String(joiner.user._id));
    expect(payload.team.members).toHaveLength(2);
    // the invite code NEVER rides a socket — the board room is every-authed-user territory
    expect(JSON.stringify(payload)).not.toContain("inviteCode");
    watcherSocket.close();
  });

  test("a new team pushes teamCreated (safe payload) to the board room", async () => {
    const leader = await makeUser("Create Leader");
    const watcher = await makeUser("Create Watcher");
    const socket = connectClient(watcher.token);
    await new Promise((resolve) => socket.on("connect", resolve));
    await subscribe(socket, "hackathon:subscribe", String(hackathon._id));

    const teamCreated = nextEvent(socket, "teamCreated");
    const res = await createTeamViaApi(leader, "Announced Team");
    expect(res.status).toBe(201);
    const payload = await teamCreated;
    expect(String(payload.teamId)).toBe(String(res.body.team._id));
    expect(JSON.stringify(payload)).not.toContain("inviteCode");
    socket.close();
  });
});

describe("audit trail: every action leaves a row", () => {
  test("full lifecycle writes the complete action sequence", async () => {
    const leader = await makeUser("Audit Leader");
    const joiner = await makeUser("Audit Joiner");
    const requester = await makeUser("Audit Requester");
    const extra = await makeUser("Audit Extra");

    const created = await createTeamViaApi(leader, "Audited Team");
    const teamId = created.body.team._id;
    expect(created.status).toBe(201); // team_created

    const joined = await authPost(joiner.token, "/api/teams/join", {
      inviteCode: created.body.team.inviteCode,
      idempotencyKey: crypto.randomUUID()
    });
    expect(joined.status).toBe(200); // member_joined (via invite code)

    const reqCreated = await authPost(requester.token, `/api/teams/${teamId}/requests`, {
      idempotencyKey: crypto.randomUUID()
    });
    expect(reqCreated.status).toBe(201); // join_request_created

    const declineRes = await request(app)
      .patch(`/api/teams/${teamId}/requests/${reqCreated.body.request._id}/decline`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(declineRes.status).toBe(200); // request_declined

    const reqAgain = await authPost(requester.token, `/api/teams/${teamId}/requests`, {
      idempotencyKey: crypto.randomUUID()
    });
    expect(reqAgain.status).toBe(201);

    const acceptRes = await request(app)
      .patch(`/api/teams/${teamId}/requests/${reqAgain.body.request._id}/accept`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(acceptRes.status).toBe(200); // request_accepted + member_joined via socket only

    const extraJoined = await authPost(extra.token, "/api/teams/join", {
      inviteCode: created.body.team.inviteCode,
      idempotencyKey: crypto.randomUUID()
    });
    expect(extraJoined.status).toBe(200);

    const removeRes = await request(app)
      .delete(`/api/teams/${teamId}/members/${extra.user._id}`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(removeRes.status).toBe(200); // member_removed

    const joinerLeave = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${joiner.token}`);
    expect(joinerLeave.status).toBe(200); // member_left

    // leader leaves with requester still aboard → requester inherits
    const leaderLeave = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(leaderLeave.status).toBe(200); // leadership_transferred

    // requester is now the last member → leaving deletes the team
    const lastLeave = await request(app)
      .post(`/api/teams/${teamId}/leave`)
      .set("Authorization", `Bearer ${requester.token}`);
    expect(lastLeave.status).toBe(200); // team_deleted

    const actions = (await AuditLog.find({ teamId }).sort({ createdAt: 1 })).map((a) => a.action);
    expect(actions).toEqual([
      "team_created",
      "member_joined",
      "join_request_created",
      "request_declined",
      "join_request_created",
      "request_accepted",
      "member_joined",
      "member_removed",
      "member_left",
      "leadership_transferred",
      "team_deleted"
    ]);
  });

  test("members read the feed newest-first, non-members get 403", async () => {
    const leader = await makeUser("Feed Leader");
    const member = await makeUser("Feed Member");
    const outsider = await makeUser("Feed Outsider");
    const created = await createTeamViaApi(leader, "Feed Team");
    const teamId = created.body.team._id;
    await authPost(member.token, "/api/teams/join", {
      inviteCode: created.body.team.inviteCode,
      idempotencyKey: crypto.randomUUID()
    });

    const memberFeed = await request(app)
      .get(`/api/teams/${teamId}/audit`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(memberFeed.status).toBe(200);
    expect(memberFeed.body.audit.length).toBeGreaterThanOrEqual(2);
    expect(new Date(memberFeed.body.audit[0].createdAt).getTime())
      .toBeGreaterThanOrEqual(new Date(memberFeed.body.audit[memberFeed.body.audit.length - 1].createdAt).getTime());

    const outsiderFeed = await request(app)
      .get(`/api/teams/${teamId}/audit`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(outsiderFeed.status).toBe(403);
  });
});

describe("teammate suggestions", () => {
  test("ranked by complementary skills + timezone, breakdown attached, team members never suggested", async () => {
    const leader = await makeUser("Suggest Leader", ["react", "node"], "Asia/Kolkata");
    const created = await createTeamViaApi(leader, "Suggesting Team");
    const teamId = created.body.team._id;

    const teammate = await makeUser("Suggest Teammate", ["node"], "Asia/Kolkata");
    await authPost(teammate.token, "/api/teams/join", {
      inviteCode: created.body.team.inviteCode,
      idempotencyKey: crypto.randomUUID()
    });

    const perfect = await makeUser("Perfect Match", ["rust", "ai", "react"], "Asia/Kolkata"); // 2 missing + 1 overlap + tz match
    const farAway = await makeUser("Far Away", ["rust", "ai"], "Pacific/Honolulu"); // 2 missing, tz far
    const allOverlap = await makeUser("All Overlap", ["react", "node"], "UTC"); // nothing new, tz mid

    const res = await request(app)
      .get(`/api/hackathons/${hackathon._id}/suggestions`)
      .set("Authorization", `Bearer ${leader.token}`);
    expect(res.status).toBe(200);

    const ids = res.body.suggestions.map((s) => String(s.user._id));
    // nobody already in a team (leader, teammate) may EVER appear
    expect(ids).not.toContain(String(leader.user._id));
    expect(ids).not.toContain(String(teammate.user._id));

    // ranked: complementary skills win, same-skills rank last
    expect(ids.indexOf(String(perfect.user._id))).toBeLessThan(ids.indexOf(String(farAway.user._id)));
    expect(ids.indexOf(String(farAway.user._id))).toBeLessThan(ids.indexOf(String(allOverlap.user._id)));

    const top = res.body.suggestions[0];
    expect(String(top.user._id)).toBe(String(perfect.user._id));
    // the breakdown is the whole point — every score is explainable
    expect(top.score.missingSkills).toEqual(["rust", "ai"]);
    expect(top.score.overlappingSkills).toEqual(["react"]);
    expect(top.score.skillsScore).toBe(4.5);
    expect(top.score.timezoneDeltaMinutes).toBe(0);
    expect(top.score.timezoneScore).toBe(2);
    expect(top.score.total).toBe(6.5);

    // a team-less user gets a clean 409, not an empty list
    const loner = await makeUser("Teamless Loner");
    const lonerRes = await request(app)
      .get(`/api/hackathons/${hackathon._id}/suggestions`)
      .set("Authorization", `Bearer ${loner.token}`);
    expect(lonerRes.status).toBe(409);

    // cleanup for isolation: leave the team so other suites' data doesn't creep in
    await request(app).post(`/api/teams/${teamId}/leave`).set("Authorization", `Bearer ${leader.token}`);
  });
});
