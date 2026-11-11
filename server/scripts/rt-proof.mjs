// The "second browser window" proof, no browser needed: a socket client watches the hackathon board (like a TeamList tab open in another window) while plain HTTP joins/requests happen — every change must ARRIVE as a push, and the payloads must never contain an invite code. Run: node scripts/rt-proof.mjs (server must be running on :3001).
import { io } from "socket.io-client";

const API = process.env.API_URL || "http://localhost:3001";

async function registerUser(name) {
  const email = `rt-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "password123", skills: ["node"], timezone: "UTC" })
  });
  const regBody = await reg.json();
  if (!reg.ok) throw new Error(`register failed: ${JSON.stringify(regBody)}`);
  // register returns no token (by design) — log in to get the same JWT the browser flow uses
  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const loginBody = await login.json();
  if (!login.ok) throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
  return { token: loginBody.token, user: loginBody.userDetails };
}

function apiCall(token, method, path, body) {
  return fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} never arrived`)), 8000);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function main() {
  const hackathons = await fetch(`${API}/api/hackathons`).then((r) => r.json());
  const hackathonId = hackathons.hackathons[0]._id;

  const leader = await registerUser("Proof Leader");
  const joiner = await registerUser("Proof Joiner");
  const watcher = await registerUser("Proof Watcher");

  // window 2: a pure spectator, connected with the SAME JWT the REST layer uses
  const socket = io(API, { auth: { token: watcher.token }, transports: ["websocket"] });
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  await new Promise((resolve, reject) =>
    socket.emit("hackathon:subscribe", hackathonId, (ack) => (ack.status ? resolve() : reject(new Error(ack.message))))
  );
  console.log("watcher connected and subscribed to the board room");

  // window 1: leader creates a team over plain HTTP (listener armed FIRST — the push can beat the HTTP response)
  const teamCreated = nextEvent(socket, "teamCreated");
  const created = await apiCall(leader.token, "POST", "/api/teams", {
    hackathonId,
    name: `Proof Team ${Date.now()}`,
    idempotencyKey: crypto.randomUUID()
  });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  console.log("team created over HTTP");
  const teamCreatedPayload = await teamCreated;
  if (JSON.stringify(teamCreatedPayload).includes("inviteCode")) throw new Error("LEAK: invite code in socket payload");
  console.log("watcher saw teamCreated (no invite code in payload)");

  // window 1: joiner joins by code over HTTP — the watcher must receive it live
  const memberJoined = nextEvent(socket, "memberJoined");
  const joined = await apiCall(joiner.token, "POST", "/api/teams/join", {
    inviteCode: created.body.team.inviteCode,
    idempotencyKey: crypto.randomUUID()
  });
  if (joined.status !== 200) throw new Error(`join failed: ${JSON.stringify(joined.body)}`);
  const payload = await memberJoined;
  if (String(payload.userId) !== String(joiner.user._id)) throw new Error("wrong userId in memberJoined");
  console.log("watcher saw memberJoined LIVE — no refresh, no polling");

  // window 1: the team room itself — leader hears a join request the instant it's made
  const leaderSocket = io(API, { auth: { token: leader.token }, transports: ["websocket"] });
  await new Promise((resolve) => leaderSocket.on("connect", resolve));
  await new Promise((resolve, reject) =>
    leaderSocket.emit("team:subscribe", created.body.team._id, (ack) => (ack.status ? resolve() : reject(new Error(ack.message))))
  );
  const reqReceived = nextEvent(leaderSocket, "joinRequestReceived");
  const requested = await apiCall(watcher.token, "POST", `/api/teams/${created.body.team._id}/requests`, {
    idempotencyKey: crypto.randomUUID()
  });
  if (requested.status !== 201) throw new Error(`request failed: ${JSON.stringify(requested.body)}`);
  const reqPayload = await reqReceived;
  if (reqPayload.request.userId.name !== "Proof Watcher") throw new Error("request payload missing requester");
  console.log("leader saw joinRequestReceived LIVE with the requester's profile");

  // audit trail is readable by members, suggestions come back with breakdowns
  const audit = await apiCall(leader.token, "GET", `/api/teams/${created.body.team._id}/audit`);
  if (audit.status !== 200 || audit.body.audit.length < 2) throw new Error("audit feed missing rows");
  console.log(`audit feed: ${audit.body.audit.map((a) => a.action).join(" → ")}`);

  const outsiderAudit = await apiCall(watcher.token, "GET", `/api/teams/${created.body.team._id}/audit`);
  if (outsiderAudit.status !== 403) throw new Error(`outsider audit should be 403, got ${outsiderAudit.status}`);
  console.log("outsider is locked out of the audit feed (403)");

  const sugg = await apiCall(leader.token, "GET", `/api/hackathons/${hackathonId}/suggestions`);
  if (sugg.status !== 200) throw new Error(`suggestions failed: ${JSON.stringify(sugg.body)}`);
  const leaked = sugg.body.suggestions.some((s) => [leader.user._id, joiner.user._id].includes(String(s.user._id)));
  if (leaked) throw new Error("suggestions recommended a user already in a team");
  const withBreakdown = sugg.body.suggestions.filter((s) => s.score && Array.isArray(s.score.missingSkills));
  console.log(`suggestions: ${sugg.body.suggestions.length} ranked, ${withBreakdown.length} with breakdowns, no team members leaked`);

  // cleanup: decline the request, everyone leaves, team deletes itself
  const declined = await apiCall(leader.token, "PATCH", `/api/teams/${created.body.team._id}/requests/${requested.body.request._id}/decline`);
  await apiCall(joiner.token, "POST", `/api/teams/${created.body.team._id}/leave`);
  await apiCall(leader.token, "POST", `/api/teams/${created.body.team._id}/leave`);
  console.log(`cleanup done (decline: ${declined.status}, team deleted)`);

  socket.close();
  leaderSocket.close();
  console.log("\nALL REALTIME CHECKS PASSED");
}

main().catch((err) => {
  console.error("PROOF FAILED:", err.message);
  process.exit(1);
});
