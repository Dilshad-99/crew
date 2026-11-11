// Race-proof joins: every membership change is ONE atomic MongoDB operation — the FILTER checks capacity/expiry/membership and the UPDATE mutates in the same operation, so there is no read-then-write window for concurrent requests to squeeze through. Read-check-write here would be the bug; the guards below never are. Retries are made safe by idempotency keys, and every change writes an AuditLog row. Realtime emits fire AFTER these writes commit — sockets announce the truth, they never create it.
import Team from "../models/Team.js";
import JoinRequest from "../models/JoinRequest.js";
import AuditLog from "../models/AuditLog.js";
import { validateJoinInput, validateJoinRequestInput, isValidObjectId } from "../utils/validate.js";
import { withIdempotency, HttpError } from "../utils/idempotency.js";
import { TEAM_POPULATE, toSafeTeam } from "../utils/teamView.js";
import { emitToHackathon, emitToTeam } from "../realtime/events.js";

function isDuplicateKeyError(error) {
  return error.code === 11000 || error.message?.includes("E11000") || error.message?.includes("duplicate key");
}

export const joinByInviteCode = async (req, res) => {
  const { errors, value } = validateJoinInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid join input", errors });
  }

  const userId = req.user._id;

  try {
    const result = await withIdempotency(value.idempotencyKey, "join-by-invite-code", async () => {
      // THE atomic join: capacity (memberCount < maxTeamSize), code validity, expiry, and not-already-a-member
      // are all part of the MATCH, while $inc and $addToSet apply in the same operation — Mongo locks the
      // document for the match+update, so concurrent joins serialize here and only one can take a seat.
      const updated = await Team.findOneAndUpdate(
        {
          inviteCode: value.inviteCode,
          inviteCodeExpiresAt: { $gt: new Date() },
          members: { $ne: userId },
          $expr: { $lt: ["$memberCount", "$maxTeamSize"] }
        },
        { $inc: { memberCount: 1 }, $addToSet: { members: userId } },
        { new: true }
      );

      if (!updated) {
        // The atomic attempt already failed; this re-read only exists to pick the friendliest error message
        const team = await Team.findOne({ inviteCode: value.inviteCode });
        if (!team) {
          return { statusCode: 404, body: { status: false, message: "Invalid invite code" } };
        }
        if (team.inviteCodeExpiresAt.getTime() <= Date.now()) {
          return { statusCode: 403, body: { status: false, message: "Invite code has expired" } };
        }
        if (team.members.some((m) => m.equals(userId))) {
          return { statusCode: 409, body: { status: false, message: "You are already a member of this team" } };
        }
        return { statusCode: 409, body: { status: false, message: "Team is full" } };
      }

      await AuditLog.create({ teamId: updated._id, actorId: userId, action: "member_joined", details: { via: "invite_code" } });

      // Room ids are captured as strings BEFORE populate() — populating swaps hackathonId for a document, and "hackathon:[object Object]" would never match the room a client subscribed to
      const teamId = String(updated._id);
      const hackathonId = String(updated.hackathonId);
      const safeTeam = toSafeTeam(await updated.populate(TEAM_POPULATE));
      // Broadcast only after the atomic write committed — the board and the team page both hear memberJoined
      emitToHackathon(hackathonId, "memberJoined", { teamId, hackathonId, userId, team: safeTeam });
      emitToTeam(teamId, "memberJoined", { teamId, hackathonId, userId, team: safeTeam });

      return { statusCode: 200, body: { status: true, team: safeTeam } };
    });

    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    // A second team in the same hackathon can only surface here as E11000 from the unique { hackathonId, members } index — clean 409, never a duplicate
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ status: false, message: "You already have a team in this hackathon" });
    }
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ status: false, message: error.message });
    }
    console.error("Join by invite code error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const createJoinRequest = async (req, res) => {
  const { teamId } = req.params;
  const { errors, value } = validateJoinRequestInput(req.body);
  if (!isValidObjectId(teamId)) {
    return res.status(400).json({ status: false, message: "teamId must be a valid id" });
  }
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid join request input", errors });
  }

  const userId = req.user._id;

  try {
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }
    if (team.members.some((m) => m.equals(userId))) {
      return res.status(409).json({ status: false, message: "You are already a member of this team" });
    }
    if (team.memberCount >= team.maxTeamSize) {
      return res.status(409).json({ status: false, message: "Team is full" });
    }
    // Friendly pre-checks only — the hard guarantees stay in the atomic accept and the unique index
    const existingMembership = await Team.findOne({ hackathonId: team.hackathonId, members: userId });
    if (existingMembership) {
      return res.status(409).json({ status: false, message: "You already have a team in this hackathon" });
    }

    const request = await JoinRequest.create({
      teamId: team._id,
      userId,
      status: "pending",
      ...(value.idempotencyKey && { idempotencyKey: value.idempotencyKey })
    });

    await AuditLog.create({ teamId: team._id, actorId: userId, action: "join_request_created" });

    // Populate the requester so the leader's live feed shows WHO asked, then announce it inside the team room only
    const populatedRequest = await request.populate("userId", "name email skills timezone");
    emitToTeam(team._id, "joinRequestReceived", { teamId: team._id, request: populatedRequest });

    return res.status(201).json({ status: true, request: populatedRequest });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // keyPattern says WHICH unique index fired: a retried idempotencyKey replays the original request; a second pending request for the same team is a clean 409
      if (error.keyPattern?.idempotencyKey) {
        const existing = await JoinRequest.findOne({ idempotencyKey: value.idempotencyKey });
        if (existing) {
          return res.status(201).json({ status: true, request: existing, replayed: true });
        }
      }
      if (error.keyPattern?.teamId || error.keyPattern?.userId) {
        return res.status(409).json({ status: false, message: "You already have a pending request for this team" });
      }
    }
    console.error("Create join request error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const listJoinRequests = async (req, res) => {
  const { teamId } = req.params;
  if (!isValidObjectId(teamId)) {
    return res.status(400).json({ status: false, message: "teamId must be a valid id" });
  }

  try {
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }
    if (!team.leaderId.equals(req.user._id)) {
      return res.status(403).json({ status: false, message: "Only the team leader can view join requests" });
    }

    const requests = await JoinRequest.find({ teamId })
      .sort({ createdAt: 1 })
      .populate("userId", "name email skills timezone");

    res.status(200).json({ status: true, requests });
  } catch (error) {
    console.error("List join requests error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const acceptJoinRequest = async (req, res) => {
  const { teamId, requestId } = req.params;
  if (!isValidObjectId(teamId) || !isValidObjectId(requestId)) {
    return res.status(400).json({ status: false, message: "teamId and requestId must be valid ids" });
  }

  const leaderId = req.user._id;

  try {
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }
    if (!team.leaderId.equals(leaderId)) {
      return res.status(403).json({ status: false, message: "Only the team leader can accept requests" });
    }

    // Flip the request FIRST with a guarded status transition: a second accept/decline finds status != pending and stops — the member is never added twice
    const request = await JoinRequest.findOneAndUpdate(
      { _id: requestId, teamId, status: "pending" },
      { status: "accepted" },
      { new: true }
    );
    if (!request) {
      const exists = await JoinRequest.findById(requestId);
      if (!exists || String(exists.teamId) !== teamId) {
        return res.status(404).json({ status: false, message: "Join request not found" });
      }
      return res.status(409).json({ status: false, message: "Join request already processed" });
    }

    // Same atomic seat-grab as invite-code joins: capacity + not-already-member in the filter, $inc + $addToSet in the update
    let updated;
    try {
      updated = await Team.findOneAndUpdate(
        {
          _id: teamId,
          members: { $ne: request.userId },
          $expr: { $lt: ["$memberCount", "$maxTeamSize"] }
        },
        { $inc: { memberCount: 1 }, $addToSet: { members: request.userId } },
        { new: true }
      );
    } catch (addError) {
      if (isDuplicateKeyError(addError)) {
        // Requester joined another team of this hackathon while pending — release the request and fail cleanly
        await JoinRequest.updateOne({ _id: requestId }, { status: "pending" });
        return res.status(409).json({ status: false, message: "User already has a team in this hackathon" });
      }
      throw addError;
    }

    if (!updated) {
      // Seat lost to a concurrent join — release the request so the leader can retry when it matters
      await JoinRequest.updateOne({ _id: requestId }, { status: "pending" });
      const fresh = await Team.findById(teamId);
      if (fresh && fresh.members.some((m) => m.equals(request.userId))) {
        return res.status(409).json({ status: false, message: "User is already a member of this team" });
      }
      return res.status(409).json({ status: false, message: "Team is full" });
    }

    await AuditLog.create({ teamId, actorId: leaderId, action: "request_accepted", details: { newMemberId: request.userId } });

    const safeTeam = toSafeTeam(await updated.populate(TEAM_POPULATE));
    // An accepted request is both a resolved request and a member joined — board and team page both need to know
    emitToHackathon(team.hackathonId, "memberJoined", { teamId, hackathonId: team.hackathonId, userId: request.userId, team: safeTeam, via: "request_accepted" });
    emitToTeam(teamId, "memberJoined", { teamId, hackathonId: team.hackathonId, userId: request.userId, team: safeTeam, via: "request_accepted" });
    emitToTeam(teamId, "joinRequestResolved", { teamId, requestId, status: "accepted", userId: request.userId });

    res.status(200).json({ status: true, team: safeTeam, request });
  } catch (error) {
    console.error("Accept join request error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const declineJoinRequest = async (req, res) => {
  const { teamId, requestId } = req.params;
  if (!isValidObjectId(teamId) || !isValidObjectId(requestId)) {
    return res.status(400).json({ status: false, message: "teamId and requestId must be valid ids" });
  }

  const leaderId = req.user._id;

  try {
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }
    if (!team.leaderId.equals(leaderId)) {
      return res.status(403).json({ status: false, message: "Only the team leader can decline requests" });
    }

    const request = await JoinRequest.findOneAndUpdate(
      { _id: requestId, teamId, status: "pending" },
      { status: "declined" },
      { new: true }
    );
    if (!request) {
      const exists = await JoinRequest.findById(requestId);
      if (!exists || String(exists.teamId) !== teamId) {
        return res.status(404).json({ status: false, message: "Join request not found" });
      }
      return res.status(409).json({ status: false, message: "Join request already processed" });
    }

    await AuditLog.create({ teamId, actorId: leaderId, action: "request_declined", details: { declinedUserId: request.userId } });

    emitToTeam(teamId, "joinRequestResolved", { teamId, requestId, status: "declined", userId: request.userId });

    res.status(200).json({ status: true, request });
  } catch (error) {
    console.error("Decline join request error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const removeMember = async (req, res) => {
  const { teamId, memberId } = req.params;
  if (!isValidObjectId(teamId) || !isValidObjectId(memberId)) {
    return res.status(400).json({ status: false, message: "teamId and memberId must be valid ids" });
  }

  const leaderId = req.user._id;
  if (memberId === String(leaderId)) {
    return res.status(400).json({ status: false, message: "Leaders cannot remove themselves — use the leave endpoint" });
  }

  try {
    // Filter re-checks leadership AND that the target is a member, so only the leader can ever decrement a member away
    const updated = await Team.findOneAndUpdate(
      { _id: teamId, leaderId, members: memberId },
      { $pull: { members: memberId }, $inc: { memberCount: -1 } },
      { new: true }
    );
    if (!updated) {
      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({ status: false, message: "Team not found" });
      }
      if (!team.leaderId.equals(leaderId)) {
        return res.status(403).json({ status: false, message: "Only the team leader can remove members" });
      }
      return res.status(404).json({ status: false, message: "User is not a member of this team" });
    }

    await AuditLog.create({ teamId, actorId: leaderId, action: "member_removed", details: { removedUserId: memberId } });

    // String ids BEFORE populate (populate would turn hackathonId into a document and break the room name)
    const removedFromHackathonId = String(updated.hackathonId);
    const safeTeam = toSafeTeam(await updated.populate(TEAM_POPULATE));
    emitToHackathon(removedFromHackathonId, "memberRemoved", { teamId, hackathonId: removedFromHackathonId, userId: memberId, via: "removed", team: safeTeam });
    emitToTeam(teamId, "memberRemoved", { teamId, hackathonId: removedFromHackathonId, userId: memberId, via: "removed", team: safeTeam });

    res.status(200).json({ status: true, team: safeTeam });
  } catch (error) {
    console.error("Remove member error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const leaveTeam = async (req, res) => {
  const { teamId } = req.params;
  if (!isValidObjectId(teamId)) {
    return res.status(400).json({ status: false, message: "teamId must be a valid id" });
  }

  const userId = req.user._id;
  const userIdString = String(userId);

  try {
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }
    if (!team.members.some((m) => m.equals(userId))) {
      return res.status(403).json({ status: false, message: "You are not a member of this team" });
    }

    if (!team.leaderId.equals(userId)) {
      // Regular member: the filter re-checks membership, so two parallel leaves can never double-decrement
      const updated = await Team.findOneAndUpdate(
        { _id: teamId, members: userId, leaderId: { $ne: userId } },
        { $pull: { members: userId }, $inc: { memberCount: -1 } },
        { new: true }
      );
      if (!updated) {
        return res.status(409).json({ status: false, message: "Team changed while leaving — please retry" });
      }
      await AuditLog.create({ teamId, actorId: userId, action: "member_left" });
      emitToHackathon(team.hackathonId, "memberRemoved", { teamId, hackathonId: team.hackathonId, userId, via: "leave" });
      emitToTeam(teamId, "memberRemoved", { teamId, hackathonId: team.hackathonId, userId, via: "leave" });
      return res.status(200).json({ status: true, message: "You left the team" });
    }

    // Leader: every write below is guarded; if a concurrent join/leave beats us, we re-read and retry — bounded, so the worst case is a clean 409, never corruption
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = attempt === 0 ? team : await Team.findById(teamId);
      if (!current) {
        return res.status(404).json({ status: false, message: "Team not found" });
      }

      if (current.memberCount <= 1) {
        // Last member leaving: delete only if we are STILL the only member (guarded delete, not delete-blindly)
        const del = await Team.deleteOne({ _id: teamId, leaderId: userId, memberCount: 1 });
        if (del.deletedCount === 1) {
          await JoinRequest.deleteMany({ teamId });
          await AuditLog.create({ teamId, actorId: userId, action: "team_deleted" });
          emitToHackathon(current.hackathonId, "teamDeleted", { teamId, hackathonId: current.hackathonId });
          emitToTeam(teamId, "teamDeleted", { teamId, hackathonId: current.hackathonId });
          return res.status(200).json({ status: true, message: "You were the last member — the team has been deleted" });
        }
        continue; // someone joined between our read and the delete — retry as a leader with members
      }

      // Leader with members: ONE pipeline update removes the leader, decrements the count, and promotes the
      // OLDEST remaining member (first in the members array — join order), all computed at write time from
      // the document itself, so no read-then-promote race can crown a member who just left
      const updated = await Team.findOneAndUpdate(
        { _id: teamId, leaderId: userId, memberCount: { $gt: 1 } },
        [{
          $set: {
            members: { $filter: { input: "$members", cond: { $ne: [{ $toString: "$$this" }, userIdString] } } },
            memberCount: { $subtract: ["$memberCount", 1] },
            leaderId: { $arrayElemAt: [{ $filter: { input: "$members", cond: { $ne: [{ $toString: "$$this" }, userIdString] } } }, 0] }
          }
        }],
        { new: true }
      );
      if (updated) {
        await AuditLog.create({ teamId, actorId: userId, action: "leadership_transferred", details: { newLeaderId: updated.leaderId } });
        emitToHackathon(updated.hackathonId, "leaderChanged", { teamId, hackathonId: updated.hackathonId, newLeaderId: updated.leaderId, previousLeaderId: userId });
        emitToTeam(teamId, "leaderChanged", { teamId, hackathonId: updated.hackathonId, newLeaderId: updated.leaderId, previousLeaderId: userId });
        return res.status(200).json({
          status: true,
          message: "You left the team — leadership passed to the oldest remaining member",
          team: toSafeTeam(await updated.populate(TEAM_POPULATE))
        });
      }
    }

    return res.status(409).json({ status: false, message: "Team changed while leaving — please retry" });
  } catch (error) {
    console.error("Leave team error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
