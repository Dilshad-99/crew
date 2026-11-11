// The friendly pre-check ("already in a team") is only UX — the real guarantee is the unique { hackathonId, members } index: a concurrent second create loses the index race (E11000) and gets the same 409, so double-clicks and parallel requests can never create two teams. The idempotencyKey goes one step further: a literal retry replays the original 201 instead of a 409.
import crypto from "crypto";
import Team from "../models/Team.js";
import Hackathon from "../models/Hackathon.js";
import AuditLog from "../models/AuditLog.js";
import { validateTeamInput, isValidObjectId } from "../utils/validate.js";
import { withIdempotency, HttpError } from "../utils/idempotency.js";

const INVITE_CODE_TTL_MS = 24 * 60 * 60 * 1000;

const TEAM_POPULATE = [
  { path: "leaderId", select: "name" },
  { path: "members", select: "name" },
  { path: "hackathonId", select: "name minTeamSize maxTeamSize" }
];

function isDuplicateKeyError(error) {
  return error.code === 11000 || error.message?.includes("E11000") || error.message?.includes("duplicate key");
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

      const populatedTeam = await team.populate(TEAM_POPULATE);

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
