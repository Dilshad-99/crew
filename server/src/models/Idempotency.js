// Idempotency records: the unique index on { key } is the single arbiter of "did this request already run?" — first request inserts "pending" and executes, a retry after completion replays the stored response, a parallel duplicate gets 409, and a TTL index garbage-collects old records so the collection stays small.
import mongoose from "mongoose";

const IdempotencySchema = new mongoose.Schema({
  key: {
    type: String,
    required: [true, "key is required"]
  },
  endpoint: {
    type: String,
    required: [true, "endpoint is required"]
  },
  status: {
    type: String,
    enum: ["pending", "completed"],
    default: "pending"
  },
  statusCode: {
    type: Number
  },
  responseBody: {
    type: mongoose.Schema.Types.Mixed
  },
  expiresAt: {
    type: Date,
    required: [true, "expiresAt is required"]
  }
}, { timestamps: { createdAt: true, updatedAt: false } });

IdempotencySchema.index({ key: 1 }, { unique: true });
IdempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IdempotencyModel = mongoose.model("Idempotency", IdempotencySchema);

export default IdempotencyModel;
