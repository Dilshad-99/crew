import mongoose from "mongoose";

const HackathonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 100
  },
  minTeamSize: {
    type: Number,
    required: [true, "minTeamSize is required"],
    min: 1,
    max: 20
  },
  maxTeamSize: {
    type: Number,
    required: [true, "maxTeamSize is required"],
    min: 1,
    max: 20
  }
}, { timestamps: true });

const HackathonModel = mongoose.model("Hackathon", HackathonSchema);

export default HackathonModel;
