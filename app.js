require("dotenv").config()

const express = require("express")
const { createServer } = require("node:http")
const { Server } = require("socket.io")
const cors = require("cors")
const jwt = require("jsonwebtoken")

const db = require("./models")
const connectToMongo = require("./database")
const User = require("./models/user.model")
const { initAiAdsCron, getCronStatus, runCampaignPolls, runRulesEvaluation, runWeeklyDigest, runAnomalyDetection, runAdSpyPoll } = require("./cron/ai-ads-cron")

const app = express()
const server = createServer(app)
const io = new Server(server, { cors: { origin: "*" }, path: "/socket.io" })

app.use(cors({ origin: "*" }))
app.use(express.json())

app.use("/users", require("./routes/user.route"))
app.use("/chatMessages", require("./routes/chat.message.route"))
app.use("/groups", require("./routes/group.route"))

app.get("/", (_, res) => res.status(200).json({ message: `Hello, World!` }))

// ── Cron status & manual trigger routes ──
app.get("/cron/status", (_, res) => res.json(getCronStatus()))

app.post("/cron/run/:job", async (req, res) => {
  const key = req.headers["x-cron-api-key"]
  if (!key || key !== process.env.CRON_JOB_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const runners = {
    "campaign-polls": runCampaignPolls,
    "rules-evaluation": runRulesEvaluation,
    "weekly-digest": runWeeklyDigest,
    "anomaly-detect": runAnomalyDetection,
    "ad-spy-poll": runAdSpyPoll,
  }
  const runner = runners[req.params.job]
  if (!runner) return res.status(404).json({ error: `Unknown job: ${req.params.job}` })
  const result = await runner()
  res.json({ success: true, job: req.params.job, result })
})

app.get(`/badges`, async (_, res) => {
  const badges = await db.chatBadge.find({ isActive: true })
  res.status(200).json(badges)
})

// --- Socket state ---
// userId (string) -> Set of socketIds (a user may have multiple tabs)
const userSockets = new Map()
// Set of online userIds
const onlineUsers = new Set()
// Rate limiting: "userId:groupId" -> { count, windowStart }
const groupRateLimits = new Map()

/**
 * Helper: get all socketIds for a given userId
 */
function getSocketIds(userId) {
  return userSockets.get(String(userId)) || new Set()
}

/**
 * Helper: emit to a specific userId (all their sockets)
 */
function emitToUser(userId, event, data) {
  const sids = getSocketIds(userId)
  for (const sid of sids) {
    io.to(sid).emit(event, data)
  }
}

/**
 * Helper: emit to two DM participants only
 */
function emitToParticipants(userIdA, userIdB, event, data) {
  emitToUser(userIdA, event, data)
  if (String(userIdA) !== String(userIdB)) {
    emitToUser(userIdB, event, data)
  }
}

/**
 * Helper: get both participant userIds from a chatRequest
 */
function getChatParticipants(chatRequest) {
  return [String(chatRequest.senderId), String(chatRequest.receiverId)]
}

// --- NextAuth JWE token decoder ---
// NextAuth v4 encrypts JWT in the cookie using JWE (A256GCM).
// We need jose to decrypt it (jsonwebtoken can't handle JWE).
const { jwtDecrypt } = require("jose")

async function decodeNextAuthToken(token, secret) {
  try {
    // NextAuth v4 derives a 256-bit key from the secret via HKDF
    const crypto = require("crypto")
    // Use Node's built-in HKDF (available since Node 15)
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.hkdf("sha256", secret, "", "NextAuth.js Generated Encryption Key", 32, (err, key) => {
        if (err) reject(err)
        else resolve(new Uint8Array(key))
      })
    })

    const { payload } = await jwtDecrypt(token, derivedKey, {
      clockTolerance: 15,
    })
    return payload
  } catch {
    // Fallback: try plain JWT verify (for custom tokens)
    try {
      return jwt.verify(token, secret)
    } catch {
      return null
    }
  }
}

// --- Socket authentication middleware ---
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token
  const directUserId = socket.handshake.auth?.userId

  if (!token && !directUserId) {
    return next(new Error("Authentication error: no token provided"))
  }

  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return next(new Error("Authentication error: server misconfigured"))
  }

  // If we have a token, try to decode it
  if (token) {
    const decoded = await decodeNextAuthToken(token, secret)
    if (decoded) {
      socket.userId = decoded.sub || decoded.id || decoded.userId || decoded._id
      if (socket.userId) return next()
    }
  }

  // Fallback: use the userId sent directly from the session
  // (trusted because it comes from the authenticated Next.js app)
  if (directUserId) {
    socket.userId = directUserId
    return next()
  }

  return next(new Error("Authentication error: invalid token"))
})

io.on("connection", (socket) => {
  console.log("a user connected:", socket.userId)

  // --- Register / Online status ---
  socket.on("register", (data) => {
    const userId = String(data?.userId || socket.userId)
    socket.registeredUserId = userId

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set())
    }
    userSockets.get(userId).add(socket.id)

    if (!onlineUsers.has(userId)) {
      onlineUsers.add(userId)
      io.emit("user-online", { userId })
    }
  })

  // Auto-register from auth if client doesn't send register
  {
    const userId = String(socket.userId)
    socket.registeredUserId = userId
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set())
    }
    userSockets.get(userId).add(socket.id)

    if (!onlineUsers.has(userId)) {
      onlineUsers.add(userId)
      io.emit("user-online", { userId })
    }
  }

  socket.on("get-online-users", () => {
    socket.emit("online-users", Array.from(onlineUsers))
  })

  // --- DM: send message (Bug #1 - target only sender+receiver) ---
  socket.on(`send-message`, async (data) => {
    try {
      const chatMessage = await db.chatMessage.create({ ...data })
      emitToParticipants(
        String(data.senderId),
        String(data.receiverId),
        "receive-message",
        chatMessage
      )
    } catch (err) {
      console.error("send-message error:", err.message)
    }
  })

  // --- Group: join room ---
  socket.on(`join-room`, (data) => {
    socket.join(data.groupId)
  })

  // --- Group: send message (Feature #9 - rate limiting) ---
  socket.on("group-message", async (data) => {
    try {
      // Rate limiting check
      const group = await db.group.findById(data.groupId)
      if (group) {
        const rateKey = `${data.senderId}:${data.groupId}`
        const now = Date.now()
        let rateInfo = groupRateLimits.get(rateKey)

        if (!rateInfo || now - rateInfo.windowStart > 60000) {
          rateInfo = { count: 0, windowStart: now }
          groupRateLimits.set(rateKey, rateInfo)
        }

        const limit = group.messagesPerMinute || 5
        if (rateInfo.count >= limit) {
          socket.emit("rate-limited", {
            groupId: data.groupId,
            messagesPerMinute: limit,
            message: `Rate limited: max ${limit} messages per minute in this group`,
          })
          return
        }

        rateInfo.count++
      }

      const groupMembers = await db.groupMember.find({
        groupId: data.groupId,
        userId: { $ne: data.senderId },
        status: "APPROVED",
      })

      const receiverIds = groupMembers.map((member) => member.userId)

      const groupMessage = {
        message: data.message,
        groupId: data.groupId,
        receiverIds,
        senderId: data.senderId,
        senderName: data.senderName,
        ...(data.chatBadgeId && { chatBadgeId: data.chatBadgeId }),
      }

      const message = await db.groupMessage.create(groupMessage)

      io.to(data.groupId).emit("group-message-receive", message)
    } catch (err) {
      console.error("group-message error:", err.message)
    }
  })

  // --- Notifications ---
  socket.on("addNotification", async (payload, userId, adminOnly = false) => {
    if (adminOnly) {
      const admins = await User.find({ role: "admin" })
      for (let i = 0; i < admins.length; i++) {
        io.emit(`notification-receive-${admins[i]?._id}`, payload)
      }
      await User.updateMany({ role: "admin" }, { $push: { notifications: payload } })
    } else {
      const user = await User.findByIdAndUpdate(
        userId,
        { $push: { notifications: payload } },
        { new: true }
      )
      if (user) {
        const newNotification = user.notifications[user.notifications.length - 1]
        io.emit(`notification-receive-${userId}`, newNotification)
      }
    }
  })

  socket.on("admin-notification", async () => {
    io.emit("adoo")
  })

  // --- Block/unblock (Bug #3 - target only two participants) ---
  socket.on("block-user", async (data) => {
    try {
      const blockedChat = await db.chatRequest.findById(data?.chatId)
      if (!blockedChat) return
      blockedChat.status = data?.status
      blockedChat.blockedBy = data?.userId
      await blockedChat.save()

      const [userA, userB] = getChatParticipants(blockedChat)
      emitToParticipants(userA, userB, "block-user-receive", blockedChat)
    } catch (err) {
      console.error("block-user error:", err.message)
    }
  })

  socket.on("unblock-user", async (data) => {
    try {
      const blockedChat = await db.chatRequest.findById(data?.chatId)
      if (!blockedChat) return
      blockedChat.status = data?.status
      blockedChat.blockedBy = null
      await blockedChat.save()

      const [userA, userB] = getChatParticipants(blockedChat)
      emitToParticipants(userA, userB, "unblock-user-receive", blockedChat)
    } catch (err) {
      console.error("unblock-user error:", err.message)
    }
  })

  // --- Remove user (Bug #4 - include username) ---
  socket.on(`remove-user`, async (data) => {
    try {
      // Look up the group member to get the userId before deleting
      const memberDoc = await db.groupMember.findById(data.memberId)
      let removedUser = null
      if (memberDoc) {
        removedUser = await User.findById(memberDoc.userId).select("_id name email")
      }

      await db.groupMember.findByIdAndDelete(data.memberId)

      const updatedGroup = await db.group.findByIdAndUpdate(
        data?.groupId,
        { $pull: { members: data?.memberId } },
        { new: true }
      )

      io.emit(`remove-member-receive`, {
        groupId: data.groupId,
        userId: removedUser?._id || data.memberId,
        username: removedUser?.name || null,
        email: removedUser?.email || null,
        groupTitle: updatedGroup?.title,
      })
    } catch (err) {
      console.error("remove-user error:", err.message)
    }
  })

  // --- Exit group ---
  socket.on(`exit-group`, async (data) => {
    try {
      const groupMember = await db.groupMember.findOne({
        groupId: data?.groupId,
        userId: data?.userId,
      })

      if (groupMember) {
        await db.groupMember.findByIdAndDelete(groupMember._id)
        await db.group.findByIdAndUpdate(
          data?.groupId,
          { $pull: { members: groupMember._id } },
          { new: true }
        )
      }

      io.emit(`exit-group-receive`, {
        groupId: data?.groupId,
        userId: data?.userId,
      })
    } catch (err) {
      console.error("exit-group error:", err.message)
    }
  })

  // --- Delete message (Bug #2 - target only two participants) ---
  socket.on(`messageDeletedReceiver`, async (message) => {
    try {
      const original = await db.chatMessage.findById(message._id)
      await db.chatMessage.findByIdAndDelete(message._id)
      const messages = await db.chatMessage.find({ chatId: message.chatId })

      if (original) {
        emitToParticipants(
          String(original.senderId),
          String(original.receiverId),
          "messageDeleted",
          messages
        )
      } else {
        // Fallback: couldn't find original, emit to sender at least
        socket.emit("messageDeleted", messages)
      }
    } catch (err) {
      console.error("messageDeletedReceiver error:", err.message)
    }
  })

  // --- Edit message (Bug #2 - target only two participants) ---
  socket.on(`messageEditReceiver`, async (message) => {
    try {
      const original = await db.chatMessage.findById(message._id)
      await db.chatMessage.findByIdAndUpdate(
        message._id,
        { "message.content": message.message.content },
        { new: true }
      )
      const messages = await db.chatMessage.find({ chatId: message.chatId })

      if (original) {
        emitToParticipants(
          String(original.senderId),
          String(original.receiverId),
          "messageEdit",
          messages
        )
      } else {
        socket.emit("messageEdit", messages)
      }
    } catch (err) {
      console.error("messageEditReceiver error:", err.message)
    }
  })

  // --- Typing indicators (Feature #7) ---
  socket.on("typing-start", (data) => {
    if (data.groupId) {
      // Group typing: broadcast to the group room except sender
      socket.to(data.groupId).emit("typing-indicator", {
        senderId: data.senderId,
        groupId: data.groupId,
        isTyping: true,
      })
    } else if (data.receiverId) {
      // DM typing: send only to receiver
      emitToUser(String(data.receiverId), "typing-indicator", {
        senderId: data.senderId,
        receiverId: data.receiverId,
        isTyping: true,
      })
    }
  })

  socket.on("typing-stop", (data) => {
    if (data.groupId) {
      socket.to(data.groupId).emit("typing-indicator", {
        senderId: data.senderId,
        groupId: data.groupId,
        isTyping: false,
      })
    } else if (data.receiverId) {
      emitToUser(String(data.receiverId), "typing-indicator", {
        senderId: data.senderId,
        receiverId: data.receiverId,
        isTyping: false,
      })
    }
  })

  // --- Read receipts (Feature #8) ---
  socket.on("mark-read", async (data) => {
    try {
      const { chatId, userId } = data
      if (!chatId || !userId) return

      // Update all messages in this chat that this user hasn't read yet
      const result = await db.chatMessage.updateMany(
        {
          chatId,
          senderId: { $ne: userId },
          "readBy.userId": { $ne: userId },
        },
        {
          $push: { readBy: { userId, readAt: new Date() } },
        }
      )

      if (result.modifiedCount > 0) {
        // Find the other participant to notify them
        const sampleMessage = await db.chatMessage.findOne({ chatId })
        if (sampleMessage) {
          const otherUserId =
            String(sampleMessage.senderId) === String(userId)
              ? String(sampleMessage.receiverId)
              : String(sampleMessage.senderId)

          emitToUser(otherUserId, "messages-read", {
            chatId,
            userId,
            readAt: new Date(),
            count: result.modifiedCount,
          })
        }
      }
    } catch (err) {
      console.error("mark-read error:", err.message)
    }
  })

  socket.on("mark-read-group", async (data) => {
    try {
      const { groupId, userId } = data
      if (!groupId || !userId) return

      await db.groupMessage.updateMany(
        {
          groupId,
          senderId: { $ne: userId },
          "readBy.userId": { $ne: userId },
        },
        {
          $push: { readBy: { userId, readAt: new Date() } },
        }
      )

      io.to(groupId).emit("group-messages-read", {
        groupId,
        userId,
        readAt: new Date(),
      })
    } catch (err) {
      console.error("mark-read-group error:", err.message)
    }
  })

  // --- Disconnect: online status (Feature #6) ---
  socket.on("disconnect", () => {
    const userId = socket.registeredUserId || String(socket.userId)
    console.log("user disconnected:", userId)

    const sids = userSockets.get(userId)
    if (sids) {
      sids.delete(socket.id)
      if (sids.size === 0) {
        userSockets.delete(userId)
        onlineUsers.delete(userId)
        io.emit("user-offline", { userId })
      }
    }
  })
})

const PORT = process.env.PORT || 8080

server.listen(PORT, () => {
  connectToMongo()
  initAiAdsCron(io)
  console.log(`server running at http://localhost:${PORT}`)
})

// module.exports = server
