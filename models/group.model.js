const mongoose = require("mongoose")

const groupSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    adminId: {
      type: mongoose.Schema.ObjectId,
      ref: "user",
      required: true,
    },
    messagesPerMinute: { type: Number, default: 5 },
    members: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "groupMember",
      },
    ],
  },
  { timestamps: true }
)

const Group = mongoose.models.group || mongoose.model("group", groupSchema)

module.exports = Group
