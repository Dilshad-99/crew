import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { createTeam, listTeams, getTeamById, getTeamAudit } from "../controllers/teamController.js";
import {
  joinByInviteCode,
  createJoinRequest,
  listJoinRequests,
  acceptJoinRequest,
  declineJoinRequest,
  removeMember,
  leaveTeam
} from "../controllers/joinController.js";

const router = Router();

router.post("/", requireAuth, createTeam);
router.get("/", listTeams);
router.get("/:teamId", getTeamById);
router.get("/:teamId/audit", requireAuth, getTeamAudit);
router.post("/join", requireAuth, joinByInviteCode);
router.post("/:teamId/requests", requireAuth, createJoinRequest);
router.get("/:teamId/requests", requireAuth, listJoinRequests);
router.patch("/:teamId/requests/:requestId/accept", requireAuth, acceptJoinRequest);
router.patch("/:teamId/requests/:requestId/decline", requireAuth, declineJoinRequest);
router.delete("/:teamId/members/:memberId", requireAuth, removeMember);
router.post("/:teamId/leave", requireAuth, leaveTeam);

export default router;
