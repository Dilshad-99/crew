import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { createTeam, listTeams } from "../controllers/teamController.js";

const router = Router();

router.post("/", requireAuth, createTeam);
router.get("/", listTeams);

export default router;
