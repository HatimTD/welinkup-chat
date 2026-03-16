const express = require("express")
const router = express.Router()

const db = require("../models")

router.get("/", async (req, res) => {
  try {
    const users = await db.user.find()
    res.status(200).json(users)
  } catch (err) {
    console.error("GET /users error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get("/chat", async (req, res) => {
  try {
    const { receiverId } = req.query

    if (!receiverId) {
      return res.status(400).json({ message: `receiverId is required` })
    }

    const messages = await db.chatRequest
      .find({ receiverId, status: "accepted" })
      .populate({ path: "senderId", select: "name email" })
    res.status(200).json(messages)
  } catch (err) {
    console.error("GET /chat error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get(`/chatRequests/:receiverId`, async (req, res) => {
  const { receiverId } = req.params

  if (!receiverId) {
    return res.status(400).json({ message: `receiverId is required` })
  }

  const chatRequests = await db.chatRequest
    .find({ receiverId, status: "pending" })
    .populate({ path: "senderId", select: "_id name email" })

  res.status(200).json(chatRequests)
})

router.post(`/users-chatrequests/action/:chatRequestId`, async (req, res) => {
  try {
    const { chatRequestId } = req.params
    const { action } = req.query

    if (!chatRequestId) {
      return res.status(400).json({ message: `chatRequestId is required` })
    }

    if (!action) {
      return res.status(400).json({ message: `action is required` })
    }

    const chatRequest = await db.chatRequest.findById(chatRequestId)

    if (!chatRequest) {
      return res.status(404).json({ message: `Chat Request not found` })
    }

    if (action === "reject") {
      await db.chatRequest.findByIdAndDelete(chatRequestId)
      return res.status(200).json({ message: `Chat Request rejected` })
    }

    const chatReq = await db.chatRequest.findByIdAndUpdate(
      chatRequestId,
      { status: "accepted" },
      { new: true }
    )

    res.status(200).json(chatReq)
  } catch (err) {
    console.error("POST action error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get(`/chatUsers/:user`, async (req, res) => {
  const { user } = req.params

  if (!user) {
    return res.status(400).json({ message: `user is required` })
  }

  try {
    // TODO: Fix this
    const chatUsers = await db.chatRequest
      .find({
        status: { $in: ["accepted", "blocked"] },
        $or: [{ receiverId: user }, { senderId: user }],
      })
      .populate({ path: "senderId", select: "_id name email" })
      .populate({ path: "receiverId", select: "_id name email" })

    const chatUsersFormatted = chatUsers.map((chatUser) => {
      let chat

      if (chatUser.senderId._id.toString() === user) {
        chat = chatUser.receiverId
      } else {
        chat = chatUser.senderId
      }

      return { ...chatUser._doc, chat }
    })

    res.status(200).json(chatUsersFormatted)
  } catch (err) {
    console.log(err)
    res.status(500).json({ message: `Internal server error` })
  }
})

router.get("/chatMessages", async (req, res) => {
  const { receiverId, senderId, page: pageStr, limit: limitStr } = req.query

  if (!receiverId || !senderId) {
    return res
      .status(400)
      .json({ message: `receiverId and senderId are required` })
  }

  const page = Math.max(1, parseInt(pageStr) || 1)
  const limit = Math.max(1, Math.min(200, parseInt(limitStr) || 50))
  const skip = (page - 1) * limit

  const filter = {
    chatId: { $in: [`${receiverId}${senderId}`, `${senderId}${receiverId}`] },
  }

  const total = await db.chatMessage.countDocuments(filter)
  const messages = await db.chatMessage
    .find(filter)
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)

  const hasMore = skip + messages.length < total

  res.status(200).json({ messages, hasMore, total })
})

router.patch(`/:chatRequestId`, async (req, res) => {
  const { chatRequestId } = req.params
  const { status } = req.body

  if (!chatRequestId) {
    return res.status(400).json({ message: `chatRequestId is required` })
  }

  if (!status) {
    return res.status(400).json({ message: `status is required` })
  }

  const chatRequest = await db.chatRequest.findByIdAndUpdate(
    chatRequestId,
    req.body,
    {
      new: true,
    }
  )

  res.status(201).json(chatRequest)
})

router.get(`/users-chat/:userId`, async (req, res) => {
  const { userId } = req.params
  const { search } = req.query

  if (!userId) {
    return res.status(400).json({ message: `userId is required` })
  }

  // 1. Find Chat Requests which are already accepted and are blocked

  const chatRequests = await db.chatRequest.find({
    $or: [{ senderId: userId }, { receiverId: userId }],
    status: { $in: ["accepted", "blocked", "pending"] },
  })

  // I want to get remaining users from the collection of users except those who are already in chatRequests

  const senderIds = chatRequests.map((chatRequest) => chatRequest.senderId)
  const receiverIds = chatRequests.map((chatRequest) => chatRequest.receiverId)

  // I cant get it through _id I have to search through senderId and receiverId
  const query = {
    _id: { $nin: [userId, ...senderIds, ...receiverIds] },
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ]
  }

  const users = await db.user.find(query).select("_id name email role")
  const userIds = users.map((u) => u._id)

  // Batch fetch badges for all users in one query instead of N+1
  const badges = await db.groupMember
    .find({ userId: { $in: userIds }, chatBadgeId: { $exists: true, $ne: null } })
    .populate({ path: "chatBadgeId", select: "icon" })

  const badgeMap = new Map()
  badges.forEach((b) => {
    if (b.chatBadgeId?.icon) {
      badgeMap.set(String(b.userId), b.chatBadgeId.icon)
    }
  })

  const resp = users.map((u) => ({
    email: u.email,
    name: u.name,
    _id: u._id,
    badge: badgeMap.get(String(u._id)) || null,
    role: u.role || null,
  }))
  res.status(200).json(resp)
})

router.post(`/users-chat/request`, async (req, res) => {
  try {
    const { senderId, receiverId } = req.body

    if (!senderId) {
      return res.status(400).json({ message: `senderId is required` })
    }

    if (!receiverId) {
      return res.status(400).json({ message: `receiverId is required` })
    }

    const chatRequest = await db.chatRequest.create({
      senderId,
      receiverId,
      status: "pending",
    })

    res.status(201).json(chatRequest)
  } catch (err) {
    console.error("POST request error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get(`/users-chatrequests/:userId`, async (req, res) => {
  const { userId } = req.params

  if (!userId) {
    return res.status(400).json({ message: `userId is required` })
  }

  const { search } = req.query

  let userIds = []

  if (search) {
    const users = await db.user.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    })
    userIds = users.map((user) => user._id)
  }

  const query = {
    receiverId: userId,
    status: "pending",
  }

  if (userIds.length > 0) {
    query.senderId = { $in: userIds }
  }

  const chatRequests = await db.chatRequest
    .find(query)
    .populate({ path: "senderId", select: "_id name email" })

  res.status(200).json(chatRequests)
})

router.get(`/create/globalGroup`, async (req, res) => {
  const globalGroupId = `661541c6b0e327d3ec5266b9`

  const users = await db.user.find()

  // 1. Add each user to the groupMember collection
  // 2. Collect _id array and attach it to group field of members

  const members = []

  for (let user of users) {
    let member = await db.groupMember.create({
      role: `NORMAL`,
      status: `APPROVED`,
      groupId: globalGroupId,
      userId: user._id,
    })

    console.log("member :>> ", member)
    members.push(member._id)
  }

  console.log("members :>> ", members)

  const updatedGroup = await db.group.findByIdAndUpdate(globalGroupId, {
    $set: { members },
  })

  res.status(200).json(updatedGroup)
})

module.exports = router
