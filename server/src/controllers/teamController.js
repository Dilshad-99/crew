// The friendly pre-check ("already in a team") is only UX — the real guarantee is the unique { hackathonId, members } index: a concurrent second create loses the index race (E11000) and gets the same 409, so double-clicks and parallel requests can never create two teams.
import crypto from "crypto";
import Team from "../models/Team.js";
import Hackathon from "../models/Hackathon.js";
import AuditLog from "../models/AuditLog.js";
import { validateTeamInput, isValidObjectId } from "../utils/validate.js";

const INVITE_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export const createTeam = async (req, res) => {
  const { errors, value } = validateTeamInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid team input", errors });
  }

  const leaderId = req.user._id;

  try {
    const hackathon = await Hackathon.findById(value.hackathonId);
    if (!hackathon) {
      return res.status(404).json({ status: false, message: "Hackathon not found" });
    }

    const existing = await Team.findOne({ hackathonId: value.hackathonId, members: leaderId });
    if (existing) {
      return res.status(409).json({ status: false, message: "You already have a team in this hackathon" });
    }

    const team = await Team.create({
      hackathonId: value.hackathonId,
      name: value.name,
      leaderId,
      members: [leaderId],
      memberCount: 1,
      inviteCode: crypto.randomBytes(6).toString("hex"),
      inviteCodeExpiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS)
    });

    await AuditLog.create({ teamId: team._id, actorId: leaderId, action: "team_created" });

    const populatedTeam = await team.populate([
      { path: "leaderId", select: "name" },
      { path: "members", select: "name" },
      { path: "hackathonId", select: "name" }
    ]);

    res.status(201).json({ status: "OK", team: populatedTeam });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: false, message: "You already have a team in this hackathon" });
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
      .populate("leaderId", "name")
      .populate("members", "name")
      .populate("hackathonId", "name");

    res.status(200).json({ status: true, teams });
  } catch (error) {
    console.error("List teams error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
