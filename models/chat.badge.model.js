const mongoose = require("mongoose")

const chatBadgeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    icon: {
      type: String,
    },
    colorCode: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, versionKey: false }
)

const ChatBadge =
  mongoose.models.chatBadge ||
  mongoose.model("chatBadge", chatBadgeSchema)

module.exports = ChatBadge
