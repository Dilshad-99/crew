// Unique MULTIKEY compound index on { hackathonId, members }: Mongo indexes every (hackathon, member) pair, so the same user can never appear in two teams of one hackathon — enforced by the database even under concurrent writes, not by application code.
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

const TeamModel = mongoose.model("Team", TeamSchema);

export default TeamModel;
