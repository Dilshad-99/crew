// Fail fast at boot: a server that starts without its database would only serve confusing 500s, so we crash and let the platform restart us until Mongo is reachable.
import mongoose from "mongoose";

const url = process.env.MONGODB_URI;

if (!url) {
  console.error("MONGODB_URI is missing in the environment");
  process.exit(1);
}

mongoose.connect(url)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });

export default mongoose.connection;
