// Idempotent boot-time seed: a fresh database (local or Atlas) always ends up with at least one hackathon, so the team list and create-team UI work immediately after deploy.
import Hackathon from "./models/Hackathon.js";

const DEFAULT_HACKATHON = {
  name: "Hack4Hack 2026",
  minTeamSize: 2,
  maxTeamSize: 5
};

export async function seedDefaultHackathon() {
  try {
    await Hackathon.findOneAndUpdate(
      { name: DEFAULT_HACKATHON.name },
      { minTeamSize: DEFAULT_HACKATHON.minTeamSize, maxTeamSize: DEFAULT_HACKATHON.maxTeamSize },
      { upsert: true }
    );
    console.log("Default hackathon seeded:", DEFAULT_HACKATHON.name);
  } catch (error) {
    console.error("Seeding failed:", error.message);
  }
}
