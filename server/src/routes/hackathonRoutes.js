import { Router } from "express";
import { listHackathons } from "../controllers/hackathonController.js";

const router = Router();

router.get("/", listHackathons);

export default router;
