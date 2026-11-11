import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: [true, "teamId is required"]
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "actorId is required"]
  },
  action: {
    type: String,
    required: [true, "action is required"]
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  }
}, { timestamps: { createdAt: true, updatedAt: false } });

const AuditLogModel = mongoose.model("AuditLog", AuditLogSchema);

export default AuditLogModel;
