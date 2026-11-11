import Hackathon from "../models/Hackathon.js";

export const listHackathons = async (req, res) => {
  try {
    const hackathons = await Hackathon.find().sort({ createdAt: -1 });
    res.status(200).json({ status: true, hackathons });
  } catch (error) {
    console.error("List hackathons error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
