// One execution per idempotencyKey, guaranteed by the DB: the INSERT of the record races on the unique index, not application logic — whoever wins runs the operation, everyone else gets the stored result (replay) or 409 (still in flight). Failed attempts free the key so an honest retry can execute again.
import Idempotency from "../models/Idempotency.js";

const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

// Thrown for control-flow HTTP responses (e.g. duplicate key in flight) so controllers can map it cleanly
export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isDuplicateKeyError(error) {
  return error.code === 11000 || error.message?.includes("E11000") || error.message?.includes("duplicate key");
}

// fn must return { statusCode, body } — exactly what got returned to the first caller is stored and replayed
export async function withIdempotency(key, endpoint, fn) {
  try {
    await Idempotency.create({
      key,
      endpoint,
      expiresAt: new Date(Date.now() + RECORD_TTL_MS)
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Idempotency.findOne({ key });
      if (existing && existing.status === "completed") {
        return { statusCode: existing.statusCode, body: existing.responseBody, replayed: true };
      }
      throw new HttpError(409, "A request with this idempotency key is already in progress");
    }
    throw error;
  }

  try {
    const result = await fn();
    await Idempotency.updateOne(
      { key },
      { status: "completed", statusCode: result.statusCode, responseBody: result.body }
    );
    return { statusCode: result.statusCode, body: result.body, replayed: false };
  } catch (error) {
    // The operation failed — release the key so a retry re-executes instead of replaying the failure
    await Idempotency.deleteOne({ key });
    throw error;
  }
}
