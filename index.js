import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);
// Stripe Webhook Endpoint (MUST be before express.json() to preserve raw body buffer for signature verification)
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      console.error("STRIPE_WEBHOOK_SECRET is not configured in .env");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      try {
        await recordPaymentAndUpgradeUser(session);
        console.log(`Successfully processed webhook for session: ${session.id}`);
      } catch (err) {
        console.error("Error processing checkout.session.completed:", err);
        return res.status(500).json({ error: "Failed to process payment" });
      }
    }

    res.json({ received: true });
  }
);

app.use(express.json());

// MongoDB Database & Collections Configuration
import {
  client,
  database,
  users,
  sessions,
  jobsCollection,
  applicationsCollection,
  paymentCollection,
} from "./src/config/db.js";

// Authentication & Authorization Middlewares
import {
  isUserPremium,
  verifyToken,
  authorize,
  checkJobOwnership,
} from "./src/middlewares/auth.js";


// ----------------- Base & User Routes -----------------
import userRoutes from "./src/routes/userRoutes.js";
app.use("/", userRoutes);

// ----------------- Jobs Routes -----------------
import jobRoutes from "./src/routes/jobRoutes.js";
app.use("/jobs", jobRoutes);

// ----------------- Applications Routes -----------------
app.post("/applications", verifyToken, authorize("seeker"), async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ success: false, error: "jobId is required" });
    }

    // 1. Whitelist allowed application fields
    const ALLOWED_APPLICATION_FIELDS = [
      "jobId",
      "jobTitle",
      "companyName",
      "companyLogo",
      "category",
      "jobType",
      "isRemote",
      "location",
      "salaryMin",
      "salaryMax",
      "salaryFrequency",
      "seekerName",
      "seekerPhone",
      "resumeUrl",
      "coverLetter",
    ];

    const application = {};
    for (const field of ALLOWED_APPLICATION_FIELDS) {
      if (req.body[field] !== undefined) {
        application[field] = req.body[field];
      }
    }

    // 2. Enforce server-controlled identity and initial status
    const seekerEmail = req.user.email;
    const userId = req.user._id?.toString() || req.user.id;

    application.seekerEmail = seekerEmail;
    application.userId = userId;
    application.status = "Applied";
    application.appliedAt = new Date().toISOString();

    // 3. Premium and quota check (3 free applications for non-premium, no $or)
    const isPremium = req.user.premium === true || (await isUserPremium(userId, seekerEmail));

    if (!isPremium) {
      const count = await applicationsCollection.countDocuments({ seekerEmail });
      if (count >= 3) {
        return res.status(403).json({
          success: false,
          limitReached: true,
          count,
          error: "APPLICATION_LIMIT_REACHED",
          message: "You have reached the maximum limit of 3 free applications. Please upgrade to Pro.",
          redirectUrl: "/dashboard/job-seeker/billing",
        });
      }
    }

    // 4. Prevent duplicate application for the same job (no $or)
    const alreadyApplied = await applicationsCollection.findOne({
      jobId,
      seekerEmail,
    });
    if (alreadyApplied) {
      return res.status(409).json({
        success: false,
        alreadyApplied: true,
        error: "ALREADY_APPLIED",
        message: "You have already applied for this job.",
      });
    }

    const result = await applicationsCollection.insertOne(application);
    res.json(result);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        alreadyApplied: true,
        error: "ALREADY_APPLIED",
        message: "You have already applied for this job.",
      });
    }
    console.error("Error creating application:", error);
    res.status(500).json({ success: false, error: "Failed to submit application" });
  }
});

app.get("/applications/count", verifyToken, async (req, res) => {
  try {
    const seekerEmail = req.user.email;
    const userId = req.user._id?.toString() || req.user.id;
    const isPremium = req.user.premium === true || (await isUserPremium(userId, seekerEmail));

    // Direct count by authenticated seeker's email (no $or needed)
    const count = await applicationsCollection.countDocuments({ seekerEmail });

    res.json({
      count,
      isPremium,
      limit: isPremium ? "unlimited" : 3,
      limitReached: isPremium ? false : count >= 3,
      remaining: isPremium ? 999999 : Math.max(0, 3 - count),
    });
  } catch (error) {
    console.error("Error getting applications count:", error);
    res.status(500).json({ count: 0, limit: 3, limitReached: false, remaining: 3 });
  }
});

app.get("/applications", verifyToken, checkJobOwnership, async (req, res) => {
  try {
    const { jobId } = req.query;
    const query = {};

    // 1. Seeker: only see their own applications
    if (req.user?.role === "seeker") {
      query.seekerEmail = req.user.email;
    }
    // 2. Specific jobId requested
    else if (jobId && jobId !== "undefined") {
      query.jobId = jobId;
    }
    // 3. Recruiter without jobId: rejected to prevent cross-company data leaks
    else if (req.user?.role === "recruiter") {
      return res.status(400).json({ error: "jobId query parameter is required for recruiters" });
    }
    // 4. Admin without jobId: allowed to see all applications (query remains {})

    const result = await applicationsCollection.find(query).toArray();
    res.json(result);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Failed to fetch applications", error: error.message });
  }
});

app.put("/applications/:id", verifyToken, authorize("recruiter", "admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1. Whitelist valid application statuses
    const VALID_APPLICATION_STATUSES = [
      "Applied",
      "Review",
      "Shortlisted",
      "Interview",
      "Offered",
      "Rejected",
    ];
    if (!status || !VALID_APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed statuses: ${VALID_APPLICATION_STATUSES.join(", ")}`,
      });
    }

    // 2. Fetch the target application
    const applicationQuery = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const application = await applicationsCollection.findOne(applicationQuery);
    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    // 3. Ownership check: verify recruiter owns the associated job (admin is allowed)
    if (req.user?.role !== "admin") {
      const jobQuery = ObjectId.isValid(application.jobId)
        ? { _id: new ObjectId(application.jobId) }
        : { _id: application.jobId };
      const job = await jobsCollection.findOne(jobQuery);

      if (!job) {
        return res.status(404).json({ error: "Associated job not found" });
      }

      const userId = req.user?._id?.toString() || req.user?.id;
      const isOwner =
        job.recruiterEmail?.toLowerCase() === req.user?.email?.toLowerCase() ||
        job.recruiterId === userId;

      if (!isOwner) {
        return res.status(403).json({ error: "Forbidden: You do not own the job for this application" });
      }
    }

    // 4. Update ONLY status and updatedAt (no mass-assignment via req.body)
    const result = await applicationsCollection.updateOne(applicationQuery, {
      $set: {
        status,
        updatedAt: new Date(),
      },
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to update application", error: error.message });
  }
});

// ----------------- Payment Helper (Reused by POST /payment & Webhook) -----------------
export async function recordPaymentAndUpgradeUser(session, fallbackUserId = null) {
  const customerEmail = session.customer_email || session.customer_details?.email;
  const userId = session.metadata?.userId || fallbackUserId;
  const sessionId = session.id;

  // 1. Insert payment record (handle potential duplicate key gracefully)
  const existingPayment = await paymentCollection.findOne({ sessionId });
  if (!existingPayment) {
    try {
      await paymentCollection.insertOne({
        sessionId,
        status: session.status,
        payment_status: session.payment_status,
        customer_email: customerEmail || null,
        userId: userId || null,
        payment_intent: session.payment_intent,
        premium: true,
        plan: "Hireloop Pro",
        amount: session.amount_total ? session.amount_total / 100 : 20.0,
        currency: session.currency || "usd",
        payment_date: new Date(),
      });
    } catch (insertErr) {
      if (insertErr.code !== 11000) {
        throw insertErr;
      }
    }
  }

  // 2. Mark user as premium in database (no $or needed)
  let updated = false;
  if (userId) {
    if (ObjectId.isValid(userId)) {
      const res = await users.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { premium: true, updatedAt: new Date() } }
      );
      if (res.matchedCount > 0) updated = true;
    }
    if (!updated) {
      const res = await users.updateOne(
        { id: userId },
        { $set: { premium: true, updatedAt: new Date() } }
      );
      if (res.matchedCount > 0) updated = true;
    }
  }
  if (!updated && customerEmail) {
    await users.updateOne(
      { email: { $regex: new RegExp(`^${customerEmail}$`, "i") } },
      { $set: { premium: true, updatedAt: new Date() } }
    );
  }

  return { success: true };
}

// ----------------- Stripe Payment Verification -----------------
app.post("/payment", verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "Missing sessionId" });
    }

    // 1. Idempotency check: if payment already recorded, exit early
    const existingPayment = await paymentCollection.findOne({ sessionId });
    if (existingPayment) {
      return res.json({ success: true, message: "Payment already verified" });
    }

    // 2. Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session.status === "complete" || session.payment_status === "paid";

    if (!isPaid) {
      return res.status(400).json({ success: false, message: "Payment not completed" });
    }

    // 3. Verify Stripe session belongs to authenticated user (case-insensitive email)
    const customerEmail = session.customer_email || session.customer_details?.email;
    const metadataUserId = session.metadata?.userId;
    const authUserId = req.user._id?.toString() || req.user.id;

    const emailMatches =
      customerEmail &&
      req.user.email &&
      customerEmail.toLowerCase() === req.user.email.toLowerCase();
    const idMatches = metadataUserId && metadataUserId === authUserId;

    if (!emailMatches && !idMatches) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Stripe session does not belong to your account",
      });
    }

    // 4. Record payment and upgrade user via reusable helper
    await recordPaymentAndUpgradeUser(session, authUserId);

    return res.json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    // Treat duplicate-key error (11000) as already verified
    if (error.code === 11000) {
      return res.json({ success: true, message: "Payment already verified" });
    }
    console.error("Payment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Hireloop server listening on port ${port}`);
});
