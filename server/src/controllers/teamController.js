// The friendly pre-check ("already in a team") is only UX — the real guarantee is the unique { hackathonId, members } index: a concurrent second create loses the index race (E11000) and gets the same 409, so double-clicks and parallel requests can never create two teams. The idempotencyKey goes one step further: a literal retry replays the original 201 instead of a 409.
import crypto from "crypto";
import jwt from "jsonwebtoken";
import Team from "../models/Team.js";
import Hackathon from "../models/Hackathon.js";
import AuditLog from "../models/AuditLog.js";
import { validateTeamInput, isValidObjectId } from "../utils/validate.js";
import { withIdempotency, HttpError } from "../utils/idempotency.js";
import { TEAM_POPULATE, toSafeTeam } from "../utils/teamView.js";
import { emitToHackathon } from "../realtime/events.js";
import { JWT_SECRET } from "../middleware/auth.js";

const INVITE_CODE_TTL_MS = 24 * 60 * 60 * 1000;

function isDuplicateKeyError(error) {
  return error.code === 11000 || error.message?.includes("E11000") || error.message?.includes("duplicate key");
}

// The board is public, but the invite code is the leader's secret — the token is parsed opportunistically (bad token ≠ 401 here, just no extras) so one endpoint serves anonymous viewers and the leader alike
function tryParseUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export const createTeam = async (req, res) => {
  const { errors, value } = validateTeamInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid team input", errors });
  }

  const leaderId = req.user._id;

  try {
    const result = await withIdempotency(value.idempotencyKey, "create-team", async () => {
      const hackathon = await Hackathon.findById(value.hackathonId);
      if (!hackathon) {
        return { statusCode: 404, body: { status: false, message: "Hackathon not found" } };
      }

      const existing = await Team.findOne({ hackathonId: value.hackathonId, members: leaderId });
      if (existing) {
        return { statusCode: 409, body: { status: false, message: "You already have a team in this hackathon" } };
      }

      // maxTeamSize is denormalized onto the team so the atomic join filter is self-contained; the invite
      // code is unique-indexed, so the astronomically rare 48-bit collision just regenerates a fresh code
      let team;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          team = await Team.create({
            hackathonId: value.hackathonId,
            name: value.name,
            leaderId,
            members: [leaderId],
            memberCount: 1,
            maxTeamSize: hackathon.maxTeamSize,
            minTeamSize: hackathon.minTeamSize,
            inviteCode: crypto.randomBytes(6).toString("hex"),
            inviteCodeExpiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS)
          });
          break;
        } catch (error) {
          if (isDuplicateKeyError(error) && error.keyPattern?.inviteCode && attempt < 2) continue;
          throw error;
        }
      }

      await AuditLog.create({ teamId: team._id, actorId: leaderId, action: "team_created" });

      // String ids captured BEFORE populate — populated docs would stringify to "[object Object]" and wreck room routing
      const hackathonIdStr = String(team.hackathonId);
      const populatedTeam = await team.populate(TEAM_POPULATE);
      // Board listeners get the SAFE team — the invite code only ever travels in the creator's own HTTP response
      emitToHackathon(hackathonIdStr, "teamCreated", {
        teamId: String(team._id),
        hackathonId: hackathonIdStr,
        team: toSafeTeam(populatedTeam)
      });

      // The create response is the ONLY place an invite code is exposed — the leader just made it and needs it to share
      return { statusCode: 201, body: { status: "OK", team: populatedTeam } };
    });

    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ status: false, message: "You already have a team in this hackathon" });
    }
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ status: false, message: error.message });
    }
    if (error.name === "ValidationError") {
      const field = Object.keys(error.errors)?.[0];
      const msg = field ? error.errors[field].message : error.message;
      return res.status(400).json({ status: false, message: msg });
    }

    console.error("Create team error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const listTeams = async (req, res) => {
  const { hackathonId } = req.query;

  if (!hackathonId) {
    return res.status(400).json({ status: false, message: "hackathonId query parameter is required" });
  }
  if (!isValidObjectId(hackathonId)) {
    return res.status(400).json({ status: false, message: "hackathonId must be a valid id" });
  }

  try {
    const hackathon = await Hackathon.findById(hackathonId.trim());
    if (!hackathon) {
      return res.status(404).json({ status: false, message: "Hackathon not found" });
    }

    const teams = await Team.find({ hackathonId: hackathonId.trim() })
      .sort({ createdAt: -1 })
      .select("-inviteCode -inviteCodeExpiresAt")
      .populate("leaderId", "name")
      .populate("members", "name")
      .populate("hackathonId", "name minTeamSize maxTeamSize");

    res.status(200).json({ status: true, teams });
  } catch (error) {
    console.error("List teams error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

// Public team detail — anonymous viewers see the safe team; the leader (and only the leader) also gets the live invite code back, saved after a page refresh
export const getTeamById = async (req, res) => {
  const { teamId } = req.params;

  if (!isValidObjectId(teamId)) {
    return res.status(400).json({ status: false, message: "Invalid team id" });
  }

  try {
    const team = await Team.findById(teamId).populate(TEAM_POPULATE);
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }

    const viewer = tryParseUser(req);
    const isLeader = Boolean(viewer && String(team.leaderId._id) === String(viewer._id));
    const isMember = Boolean(viewer && team.members.some((m) => String(m._id) === String(viewer._id)));

    res.status(200).json({
      status: true,
      team: toSafeTeam(team),
      viewerIsMember: isMember,
      viewerIsLeader: isLeader,
      // invite code re-attached ONLY for the leader — everyone else just gets the safe team
      ...(isLeader ? { inviteCode: team.inviteCode, inviteCodeExpiresAt: team.inviteCodeExpiresAt } : {})
    });
  } catch (error) {
    console.error("Get team error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

// The visible audit trail: same AuditLog rows the controllers already write (no second logging system), members-only because it narrates internal team business
export const getTeamAudit = async (req, res) => {
  const { teamId } = req.params;

  if (!isValidObjectId(teamId)) {
    return res.status(400).json({ status: false, message: "Invalid team id" });
  }

  try {
    const team = await Team.findById(teamId).select("members");
    if (!team) {
      return res.status(404).json({ status: false, message: "Team not found" });
    }

    if (!team.members.some((m) => m.equals(req.user._id))) {
      return res.status(403).json({ status: false, message: "Only team members can view the audit feed" });
    }

    const audit = await AuditLog.find({ teamId }).sort({ createdAt: -1 }).populate("actorId", "name email");
    res.status(200).json({ status: true, audit });
  } catch (error) {
    console.error("Get audit error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
