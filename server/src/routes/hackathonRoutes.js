import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listHackathons, getSuggestions } from "../controllers/hackathonController.js";

const router = Router();

router.get("/", listHackathons);
router.get("/:id/suggestions", requireAuth, getSuggestions);

export default router;
