// Socket.io rides the SAME JWT as the REST API (handshake auth token, verified in io.use) — one login system, no sessions, and unlike my TradeX engine the room join is authorized server-side: hackathon boards are open to any logged-in user, but a team room only accepts actual members, so live events never leak to outsiders.
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import Hackathon from "../models/Hackathon.js";
import Team from "../models/Team.js";
import { JWT_SECRET } from "../middleware/auth.js";
import { isValidObjectId } from "../utils/validate.js";

let io = null;

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];

export function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true, methods: ["GET", "POST"] }
  });

  // Handshake auth: reject the connection itself on a bad/missing token, so no unauthenticated socket can ever enter a room
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || (socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      return next(new Error("No token provided"));
    }
    try {
      socket.data.user = jwt.verify(token, JWT_SECRET); // same { _id, email, role } payload as requireAuth
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    // Boards (one room per hackathon): any authenticated user may watch
    socket.on("hackathon:subscribe", async (hackathonId, ack) => {
      try {
        if (!isValidObjectId(typeof hackathonId === "string" ? hackathonId : "")) {
          return ack?.({ status: false, message: "Invalid hackathon id" });
        }
        const exists = await Hackathon.exists({ _id: hackathonId });
        if (!exists) {
          return ack?.({ status: false, message: "Hackathon not found" });
        }
        await socket.join(`hackathon:${hackathonId}`);
        ack?.({ status: true });
      } catch (error) {
        ack?.({ status: false, message: "Server error" });
      }
    });

    // Team rooms: membership is checked server-side — the client cannot self-declare access
    socket.on("team:subscribe", async (teamId, ack) => {
      try {
        if (!isValidObjectId(typeof teamId === "string" ? teamId : "")) {
          return ack?.({ status: false, message: "Invalid team id" });
        }
        const team = await Team.findById(teamId).select("members");
        if (!team) {
          return ack?.({ status: false, message: "Team not found" });
        }
        if (!team.members.some((m) => m.equals(socket.data.user._id))) {
          return ack?.({ status: false, message: "Not a member of this team" });
        }
        await socket.join(`team:${teamId}`);
        ack?.({ status: true });
      } catch (error) {
        ack?.({ status: false, message: "Server error" });
      }
    });
  });

  return io;
}

export function getIO() {
  return io;
}
