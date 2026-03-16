const express = require("express")
const router = express.Router()

const db = require("../models")

router.get("/", async (req, res) => {
  const { receiverId, senderId } = req.query

  if (!receiverId || !senderId) {
    return res.status(400).json({ message: `receiverId and senderId are required` })
  }

  const messages = await db.chatMessage
    .find({
      chatId: { $in: [`${receiverId}${senderId}`, `${senderId}${receiverId}`] },
    })
    .sort({ createdAt: 1 })

  res.status(200).json(messages)
})

module.exports = router
