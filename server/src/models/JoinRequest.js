// Two DB-level guards on join requests: (1) unique sparse index on idempotencyKey so a retried request replays the original instead of duplicating; (2) unique PARTIAL index on { teamId, userId } that only applies while status is "pending" — the database itself allows just one pending request per user per team, and re-requesting after accept/decline/leave stays possible.
import mongoose from "mongoose";

const JoinRequestSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: [true, "teamId is required"]
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "userId is required"]
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "declined"],
    default: "pending"
  },
  idempotencyKey: {
    type: String
  }
}, { timestamps: true });

JoinRequestSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
JoinRequestSchema.index(
  { teamId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

const JoinRequestModel = mongoose.model("JoinRequest", JoinRequestSchema);

export default JoinRequestModel;
