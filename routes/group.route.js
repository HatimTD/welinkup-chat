const express = require("express")

const router = express.Router()

const db = require("../models")

router.get(`/admin/groupMember/:groupId`, async (req, res) => {
  try {
    const { groupId } = req.params

    if (!groupId) {
      return res.status(400).json({ message: `groupId is required` })
    }

    const groupMembers = await db.groupMember
      .find({ groupId })
      .populate({ path: "userId" })
      .populate({ path: "chatBadgeId" })

    res.status(200).json(groupMembers)
  } catch (err) {
    console.error("GET groupMembers error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.patch(`/groupMember/:groupMemberId`, async (req, res) => {
  try {
    const { groupMemberId } = req.params

    if (!groupMemberId) {
      return res.status(400).json({ message: `groupMemberId is required` })
    }

    const groupMember = await db.groupMember.findByIdAndUpdate(
      groupMemberId,
      req.body,
      { new: true }
    )

    res.status(200).json({ groupMember })
  } catch (err) {
    console.error("PATCH groupMember error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get(`/messages/:groupId`, async (req, res) => {
  try {
    const { groupId } = req.params

    if (!groupId) {
      return res.status(400).json({ message: `groupId is required` })
    }

    const groupMessages = await db.groupMessage
      .find({ groupId })
      .populate({ path: "chatBadgeId" })

    res.status(200).json(groupMessages)
  } catch (err) {
    console.error("GET messages error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.post("/", async (req, res) => {
  try {
    const { title, description, adminId } = req.body

    if (!title || !description || !adminId) {
      return res.status(400).json({
        message: `title, description, and adminId are required`,
      })
    }

    const group = await db.group.create({ title, description, adminId })
    const member = await db.groupMember.create({
      groupId: group._id,
      userId: adminId,
      role: "ADMIN",
      status: "APPROVED",
    })

    group.members.push(member._id)
    await group.save()

    res.status(201).json(group)
  } catch (err) {
    console.error("POST group error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get(`/requests/:userId`, async (req, res) => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({ message: `userId is required` })
    }

    const userGroups = await db.groupMember.find({ userId, status: "APPROVED" })
    const userGroupIds = userGroups.map((group) => group.groupId)

    const nonMemberGroups = await db.group.find({ _id: { $nin: userGroupIds } })

    const requestedMemberships = await db.groupMember.find({
      userId,
      status: "PENDING",
    })
    const requestedGroupIds = requestedMemberships.map(
      (membership) => membership.groupId
    )

    const requestedGroups = await db.group.find({
      _id: { $in: requestedGroupIds },
    })

    const allGroups = nonMemberGroups.map((group) => ({
      ...group._doc,
      requested: false,
    }))

    requestedGroups.forEach((requestedGroup) => {
      const group = allGroups.find(
        (group) => String(group._id) === String(requestedGroup._id)
      )
      if (group) {
        group.requested = true
      } else {
        allGroups.push({
          ...requestedGroup._doc,
          requested: true,
        })
      }
    })

    res.status(200).json(allGroups)
  } catch (err) {
    console.error("GET requests error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({ message: `userId is required` })
    }

    const userGroupIds = await db.groupMember.find({ userId, status: "APPROVED" })
    const groupIds = userGroupIds.map((group) => group.groupId)

    const userGroups = await db.group.find({ _id: { $in: groupIds } }).populate({
      path: "members",
      populate: [
        { path: "userId", select: "name email" },
        { path: "chatBadgeId" },
      ],
    })

    res.status(200).json(userGroups)
  } catch (err) {
    console.error("GET groups error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

router.patch("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params

    if (!groupId) {
      return res.status(400).json({ message: `groupId is required` })
    }

    const group = await db.group.findByIdAndUpdate(groupId, req.body, {
      new: true,
    })

    if (!group) {
      return res.status(404).json({ message: `Group not found` })
    }

    res.status(200).json(group)
  } catch (err) {
    console.error("PATCH group error:", err.message)
    res.status(500).json({ message: "Internal server error" })
  }
})

module.exports = router
