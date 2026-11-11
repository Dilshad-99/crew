// Realtime is a projection of the truth, never a second source of it: controllers call these AFTER the atomic write has committed, and the emits are fire-and-forget — a dead socket can never change what the database already decided. Payloads carry the SAFE team (no invite code).
import { getIO } from "./io.js";

export function emitToHackathon(hackathonId, event, payload) {
  const io = getIO();
  if (!io) return; // no HTTP server attached (e.g. unit tests) — events simply don't fire
  io.to(`hackathon:${hackathonId}`).emit(event, payload);
}

export function emitToTeam(teamId, event, payload) {
  const io = getIO();
  if (!io) return;
  io.to(`team:${teamId}`).emit(event, payload);
}
