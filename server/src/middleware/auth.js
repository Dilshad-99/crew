// Stateless JWT in the "Authorization: Bearer <token>" header — any instance can verify a request without a session store; exact same shape as my Pawn Shop Management System (req.user = { _id, email, role }).
import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET_KEY || "crew_local_dev_secret";

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ status: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { _id, email, role }
    next();
  } catch (error) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
};

// Wired for tomorrow's leader/admin-only routes (approve/decline join requests) — kept in the auth kit so the role from the token payload is enforceable the same way the Pawn Shop did it.
export const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ status: false, message: `Forbidden: requires ${role} role` });
  }
  next();
};
