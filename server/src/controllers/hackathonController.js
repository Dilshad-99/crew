// Teammate suggestions ranked by COMPLEMENTARY skills (what the team is missing) + timezone proximity, with the full score breakdown attached to every suggestion — the ranking stays explainable instead of a black box.
import Hackathon from "../models/Hackathon.js";
import Team from "../models/Team.js";
import User from "../models/User.js";
import { isValidObjectId } from "../utils/validate.js";
import { utcOffsetMinutes } from "../utils/timezone.js";

const SUGGESTIONS_LIMIT = 10;

export const listHackathons = async (req, res) => {
  try {
    const hackathons = await Hackathon.find().sort({ createdAt: -1 });
    res.status(200).json({ status: true, hackathons });
  } catch (error) {
    console.error("List hackathons error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const getSuggestions = async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ status: false, message: "Invalid hackathon id" });
  }

  try {
    const hackathon = await Hackathon.findById(id);
    if (!hackathon) {
      return res.status(404).json({ status: false, message: "Hackathon not found" });
    }

    const teams = await Team.find({ hackathonId: id }).select("members");
    const allMemberIds = teams.flatMap((t) => t.members); // raw ObjectIds for the $nin query below

    // Suggestions only make sense from inside a team — they're ranked against what YOUR team is missing
    const myTeam = teams.find((t) => t.members.some((m) => m.equals(req.user._id)));
    if (!myTeam) {
      return res.status(409).json({
        status: false,
        message: "Join or create a team in this hackathon first — suggestions are ranked against your team's needs"
      });
    }

    const [fullTeam, me] = await Promise.all([
      Team.findById(myTeam._id).populate("members", "skills"),
      User.findById(req.user._id).select("timezone")
    ]);

    // Team lens: every member's skills combined — complementarity is measured against the whole team, not one person
    const teamSkills = new Set(fullTeam.members.flatMap((m) => (m.skills || []).map((s) => s.toLowerCase())));
    const myOffset = utcOffsetMinutes(me?.timezone || "UTC");

    const candidates = await User.find({ _id: { $nin: allMemberIds } })
      .select("name email skills timezone")
      .limit(200);

    const suggestions = candidates
      .map((candidate) => {
        const candidateSkills = [...new Set((candidate.skills || []).map((s) => s.toLowerCase()))];
        const missingSkills = candidateSkills.filter((s) => !teamSkills.has(s));
        const overlappingSkills = candidateSkills.filter((s) => teamSkills.has(s));

        const skillsScore = missingSkills.length * 2 + overlappingSkills.length * 0.5;

        const candidateOffset = utcOffsetMinutes(candidate.timezone);
        const timezoneDeltaMinutes =
          candidateOffset != null && myOffset != null ? Math.abs(candidateOffset - myOffset) : null;
        const timezoneScore =
          timezoneDeltaMinutes == null ? 0
            : timezoneDeltaMinutes <= 60 ? 2
              : timezoneDeltaMinutes <= 180 ? 1
                : 0;

        return {
          user: { _id: candidate._id, name: candidate.name, email: candidate.email, skills: candidate.skills || [], timezone: candidate.timezone },
          score: {
            missingSkills,
            overlappingSkills,
            skillsScore,
            timezoneDeltaMinutes,
            timezoneScore,
            total: skillsScore + timezoneScore
          }
        };
      })
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, SUGGESTIONS_LIMIT);

    res.status(200).json({ status: true, suggestions });
  } catch (error) {
    console.error("Get suggestions error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
