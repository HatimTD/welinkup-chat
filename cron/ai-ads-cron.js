/**
 * AI Ads Cron Jobs
 * Runs inside the Socket.io chat server to:
 * 1. Poll campaigns for changes (Meta, TikTok, Google Ads, Snapchat, Pinterest, LinkedIn)
 * 2. Evaluate automated rules
 * 3. Weekly digest, anomaly detection, ad spy
 * 4. Push real-time notifications via Socket.io
 *
 * Calls the fb-automation Next.js API endpoints on schedule.
 */

const cron = require("node-cron")

// fb-automation base URL (Next.js app)
const FB_APP_URL = process.env.FB_APP_URL || "http://localhost:3000"
const CRON_API_KEY = process.env.CRON_JOB_API_KEY || ""

// Track scheduled tasks for cleanup/testing
const scheduledTasks = []

/**
 * Call a cron endpoint on fb-automation
 * @returns {Promise<{success: boolean, data?: any, error?: string, httpStatus?: number}>}
 */
async function callCronEndpoint(path, label) {
  if (!CRON_API_KEY) {
    console.warn(`[AI Ads Cron] Skipping ${label}: CRON_JOB_API_KEY not set`)
    return { success: false, error: "CRON_JOB_API_KEY not set" }
  }

  const url = `${FB_APP_URL}${path}`
  const startTime = Date.now()
  console.log(`[AI Ads Cron] Running: ${label} → ${url}`)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-api-key": CRON_API_KEY,
      },
      signal: AbortSignal.timeout(120000), // 2 min timeout
    })

    const json = await res.json()
    const elapsed = Date.now() - startTime

    if (!res.ok) {
      console.error(`[AI Ads Cron] ${label} FAILED (${elapsed}ms): HTTP ${res.status}`, json?.message || json?.error)
      return { success: false, error: json?.message || json?.error, httpStatus: res.status }
    }

    console.log(`[AI Ads Cron] ${label} SUCCESS (${elapsed}ms):`, JSON.stringify(json).substring(0, 200))
    return { success: true, data: json }
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.error(`[AI Ads Cron] ${label} ERROR (${elapsed}ms):`, err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Run all campaign polls (Meta + TikTok + Google + Snapchat + Pinterest + LinkedIn) in parallel.
 * Each platform's endpoint is independent — Promise.allSettled ensures one failing platform
 * doesn't block the others.
 */
async function runCampaignPolls() {
  console.log("[AI Ads Cron] ⏰ Running campaign polls...")

  const [metaResult, tiktokResult, googleResult, snapchatResult, pinterestResult, linkedinResult] = await Promise.allSettled([
    callCronEndpoint("/api/cron/meta-poll", "Meta Poll"),
    callCronEndpoint("/api/cron/tiktok-poll", "TikTok Poll"),
    callCronEndpoint("/api/cron/google-poll", "Google Poll"),
    callCronEndpoint("/api/cron/snapchat-poll", "Snapchat Poll"),
    callCronEndpoint("/api/cron/pinterest-poll", "Pinterest Poll"),
    callCronEndpoint("/api/cron/linkedin-poll", "LinkedIn Poll"),
  ])

  const results = {
    meta: metaResult,
    tiktok: tiktokResult,
    google: googleResult,
    snapchat: snapchatResult,
    pinterest: pinterestResult,
    linkedin: linkedinResult,
  }

  for (const [label, result] of [
    ["Meta", metaResult],
    ["TikTok", tiktokResult],
    ["Google", googleResult],
    ["Snapchat", snapchatResult],
    ["Pinterest", pinterestResult],
    ["LinkedIn", linkedinResult],
  ]) {
    if (result.status === "fulfilled" && result.value?.success) {
      const v = result.value.data
      // Note: each fb-automation endpoint shapes its response slightly differently
      // (totalNotifications vs total_changes; usersProcessed vs users_processed).
      console.log(`[AI Ads Cron] ${label} Poll: ${v?.totalNotifications || v?.total_changes || 0} notifications, ${v?.totalPolled || v?.users_processed || v?.usersProcessed || 0} users`)
    } else {
      console.log(`[AI Ads Cron] ${label} Poll: skipped or failed`)
    }
  }

  return results
}

/**
 * Run all rules evaluations (Meta + TikTok + Google + Snapchat + Pinterest + LinkedIn) in parallel.
 * Snapchat + Pinterest endpoints are stubs on the fb-automation side until full evaluators ship.
 */
async function runRulesEvaluation() {
  console.log("[AI Ads Cron] ⏰ Running rules evaluation...")

  const [metaResult, tiktokResult, googleResult, snapchatResult, pinterestResult, linkedinResult] = await Promise.allSettled([
    callCronEndpoint("/api/cron/meta-evaluate-rules", "Meta Rules"),
    callCronEndpoint("/api/cron/tiktok-evaluate-rules", "TikTok Rules"),
    callCronEndpoint("/api/cron/google-evaluate-rules", "Google Rules"),
    callCronEndpoint("/api/cron/snapchat-evaluate-rules", "Snapchat Rules"),
    callCronEndpoint("/api/cron/pinterest-evaluate-rules", "Pinterest Rules"),
    callCronEndpoint("/api/cron/linkedin-evaluate-rules", "LinkedIn Rules"),
  ])

  const results = {
    meta: metaResult,
    tiktok: tiktokResult,
    google: googleResult,
    snapchat: snapchatResult,
    pinterest: pinterestResult,
    linkedin: linkedinResult,
  }

  for (const [label, result] of [
    ["Meta", metaResult],
    ["TikTok", tiktokResult],
    ["Google", googleResult],
    ["Snapchat", snapchatResult],
    ["Pinterest", pinterestResult],
    ["LinkedIn", linkedinResult],
  ]) {
    if (result.status === "fulfilled" && result.value?.success) {
      const v = result.value.data
      console.log(`[AI Ads Cron] ${label} Rules: ${v?.triggered || 0} triggered, ${v?.evaluated || 0} evaluated`)
    }
  }

  return results
}

/**
 * Run weekly digest
 */
async function runWeeklyDigest() {
  return callCronEndpoint("/api/cron/weekly-digest", "Weekly Digest")
}

/**
 * Run anomaly detection
 */
async function runAnomalyDetection() {
  return callCronEndpoint("/api/cron/anomaly-detect", "Anomaly Detection")
}

/**
 * Run ad spy poll
 */
async function runAdSpyPoll() {
  return callCronEndpoint("/api/cron/ad-spy-poll", "Ad Spy Poll")
}

/**
 * Run scheduled activations (process due campaign activations/pauses)
 */
async function runScheduledActivations() {
  return callCronEndpoint("/api/cron/scheduled-activations", "Scheduled Activations")
}

/**
 * Reset Welinkup AI credits for users whose billing cycle rolled over.
 * Only refills users whose plan still grants credits — handles plan
 * downgrade between cycles. Daily.
 */
async function runResetWelinkupCredits() {
  return callCronEndpoint("/api/cron/reset-welinkup-credits", "Reset Welinkup Credits")
}

/**
 * Initialize all AI Ads cron jobs
 * @param {import("socket.io").Server} io - Socket.io server instance
 */
function initAiAdsCron(io) {
  if (!CRON_API_KEY) {
    console.warn("[AI Ads Cron] CRON_JOB_API_KEY not set — cron jobs disabled")
    console.warn("[AI Ads Cron] Set CRON_JOB_API_KEY in .env to enable")
    return
  }

  console.log("[AI Ads Cron] Initializing cron jobs...")

  // ── Campaign Polling — every 15 minutes ──
  scheduledTasks.push(
    cron.schedule("*/15 * * * *", runCampaignPolls, { timezone: "Africa/Casablanca" })
  )

  // ── Rules Evaluation — every 15 minutes (offset by 7 min) ──
  scheduledTasks.push(
    cron.schedule("7,22,37,52 * * * *", runRulesEvaluation, { timezone: "Africa/Casablanca" })
  )

  // ── Anomaly Detection — every 6 hours ──
  scheduledTasks.push(
    cron.schedule("0 */6 * * *", runAnomalyDetection, { timezone: "Africa/Casablanca" })
  )

  // ── Ad Spy Poll — every 30 minutes ──
  scheduledTasks.push(
    cron.schedule("5,35 * * * *", runAdSpyPoll, { timezone: "Africa/Casablanca" })
  )

  // ── Scheduled Activations — every 1 minute ──
  scheduledTasks.push(
    cron.schedule("* * * * *", runScheduledActivations, { timezone: "Africa/Casablanca" })
  )

  // ── Weekly Digest — Sundays at 8:00 AM ──
  scheduledTasks.push(
    cron.schedule("0 8 * * 0", runWeeklyDigest, { timezone: "Africa/Casablanca" })
  )

  // ── Reset Welinkup AI Credits — daily at 4:00 AM ──
  scheduledTasks.push(
    cron.schedule("0 4 * * *", runResetWelinkupCredits, { timezone: "Africa/Casablanca" })
  )

  // ── Health check — every hour ──
  scheduledTasks.push(
    cron.schedule("0 * * * *", () => {
      console.log(`[AI Ads Cron] ✓ Healthy. Active tasks: ${scheduledTasks.length}. ${new Date().toISOString()}`)
    }, { timezone: "Africa/Casablanca" })
  )

  console.log("[AI Ads Cron] Cron jobs initialized:")
  console.log("  - Campaign polls:      every 15 min  (Meta + TikTok + Google + Snapchat + Pinterest + LinkedIn)")
  console.log("  - Rules evaluation:    every 15 min  (offset +7 min — 6 platforms)")
  console.log("  - Anomaly detection:   every 6 hours")
  console.log("  - Ad spy poll:         every 30 min")
  console.log("  - Sched. activations:  every 1 min")
  console.log("  - Weekly digest:       Sundays 8:00 AM")
  console.log("  - Welinkup credits:    daily at 4:00 AM (cycle reset)")
  console.log("  - Health check:        every hour")
  console.log(`  - Target: ${FB_APP_URL}`)
  console.log(`  - Timezone: Africa/Casablanca`)
}

/**
 * Stop all scheduled cron tasks (for testing/cleanup)
 */
function stopAllCron() {
  for (const task of scheduledTasks) {
    task.stop()
  }
  scheduledTasks.length = 0
  console.log("[AI Ads Cron] All cron jobs stopped")
}

/**
 * Get status of the cron system
 */
function getCronStatus() {
  return {
    active: scheduledTasks.length > 0,
    taskCount: scheduledTasks.length,
    cronApiKeySet: !!CRON_API_KEY,
    targetUrl: FB_APP_URL,
  }
}

module.exports = {
  initAiAdsCron,
  stopAllCron,
  getCronStatus,
  // Individual runners for testing/manual trigger
  callCronEndpoint,
  runCampaignPolls,
  runRulesEvaluation,
  runWeeklyDigest,
  runAnomalyDetection,
  runAdSpyPoll,
  runScheduledActivations,
  runResetWelinkupCredits,
}
