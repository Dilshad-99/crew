import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 8
  },
  skills: {
    type: [String],
    default: []
  },
  timezone: {
    type: String,
    default: "UTC"
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user"
  }
});

const UserModel = mongoose.model("User", UserSchema);

export default UserModel;
