// Idempotent boot-time seed: a fresh database (local or Atlas) always ends up with at least one hackathon, so the team list and create-team UI work immediately after deploy.
import Hackathon from "./models/Hackathon.js";
import Team from "./models/Team.js";

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

// Backfill for teams created before the join flow: the atomic join filter reads maxTeamSize off the team document itself, so legacy teams get it copied from their hackathon at boot
export async function backfillTeamCapacity() {
  try {
    const stale = await Team.find({ maxTeamSize: { $exists: false } });
    for (const team of stale) {
      const hackathon = await Hackathon.findById(team.hackathonId);
      if (!hackathon) continue;
      team.maxTeamSize = hackathon.maxTeamSize;
      team.minTeamSize = hackathon.minTeamSize;
      await team.save();
    }
    if (stale.length > 0) {
      console.log(`Backfilled capacity on ${stale.length} team(s)`);
    }
  } catch (error) {
    console.error("Capacity backfill failed:", error.message);
  }
}
