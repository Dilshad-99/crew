// Race-proofing lives in the indexes, not the code: (1) unique MULTIKEY index on { hackathonId, members } — Mongo indexes every (hackathon, member) pair, so one user can never be in two teams of one hackathon, enforced by the database even under concurrent writes; (2) unique inviteCode — a code can only ever identify one team. maxTeamSize is denormalized onto the team so the atomic join filter (memberCount < maxTeamSize) is self-contained: the document carries its own capacity, no extra read inside the race-critical path.
import mongoose from "mongoose";

const TeamSchema = new mongoose.Schema({
  hackathonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hackathon",
    required: [true, "hackathonId is required"]
  },
  name: {
    type: String,
    required: [true, "Team name is required"],
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  leaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "leaderId is required"]
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  memberCount: {
    type: Number,
    default: 0
  },
  maxTeamSize: {
    type: Number,
    required: [true, "maxTeamSize is required"],
    min: 1,
    max: 20
  },
  minTeamSize: {
    type: Number,
    required: [true, "minTeamSize is required"],
    min: 1,
    max: 20
  },
  inviteCode: {
    type: String,
    required: true
  },
  inviteCodeExpiresAt: {
    type: Date,
    required: true
  }
}, { timestamps: true });

TeamSchema.index({ hackathonId: 1, members: 1 }, { unique: true });
TeamSchema.index({ inviteCode: 1 }, { unique: true });

const TeamModel = mongoose.model("Team", TeamSchema);

export default TeamModel;
