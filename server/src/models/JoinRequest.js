// No routes yet (join flow is tomorrow) — the model ships now with a unique sparse index on idempotencyKey so retried/double-clicked join requests will be deduplicated at the DB level, same race-proofing idea as the Team index.
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

const JoinRequestModel = mongoose.model("JoinRequest", JoinRequestSchema);

export default JoinRequestModel;
