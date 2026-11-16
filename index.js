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
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(
  `mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@ac-znydxya-shard-00-00.9qadqxy.mongodb.net:27017,ac-znydxya-shard-00-01.9qadqxy.mongodb.net:27017,ac-znydxya-shard-00-02.9qadqxy.mongodb.net:27017/?ssl=true&replicaSet=atlas-119fez-shard-0&authSource=admin`,
);

await client.connect();
console.log("Successfully connected to MongoDB!");

const database = client.db("hireloop");
const users = database.collection("user");
const sessions = database.collection("session");
const jobsCollection = database.collection("jobs");
const applicationsCollection = database.collection("applications");
const paymentCollection = database.collection("payments");

// Initialize unique indexes for data integrity
try {
  await applicationsCollection.createIndex(
    { jobId: 1, seekerEmail: 1 },
    { unique: true }
  );
  await paymentCollection.createIndex(
    { sessionId: 1 },
    { unique: true }
  );
  console.log("Unique indexes initialized successfully!");
} catch (err) {
  console.error("Warning: Failed to initialize unique index:", err.message);
}

// Helper: Check if a user has active premium status (from user doc or payment history)
async function isUserPremium(userId, email) {
  try {
    const userQuery = [];
    if (userId && userId !== "undefined" && userId !== "null") {
      if (ObjectId.isValid(userId))
        userQuery.push({ _id: new ObjectId(userId) });
      userQuery.push({ _id: userId }, { id: userId });
    }
    if (email && email !== "undefined" && email !== "null") {
      userQuery.push({ email });
    }

    if (userQuery.length > 0) {
      const user = await users.findOne(
        { $or: userQuery },
        { projection: { premium: 1 } },
      );
      if (user?.premium === true) return true;
    }

    // Fallback check in payments collection for THIS specific user
    const paymentQuery = [];
    if (userId && userId !== "undefined" && userId !== "null") {
      paymentQuery.push({ userId });
    }
    if (email && email !== "undefined" && email !== "null") {
      paymentQuery.push({ customer_email: email });
    }

    if (paymentQuery.length > 0) {
      const paid = await paymentCollection.findOne({
        $and: [
          { $or: paymentQuery },
          { $or: [{ status: "complete" }, { payment_status: "paid" }] },
        ],
      });
      return Boolean(paid);
    }

    return false;
  } catch (error) {
    console.error("Error checking premium status:", error);
    return false;
  }
}

// Verify user using Better Auth session
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).send({ error: "Unauthorized" });
  }

  try {
    const session = await sessions.findOne({ token });

    if (!session || new Date(session.expiresAt) < new Date()) {
      return res.status(401).send({ error: "Invalid or expired session" });
    }

    const query = ObjectId.isValid(session.userId)
      ? { $or: [{ _id: new ObjectId(session.userId) }, { id: session.userId }] }
      : { id: session.userId };

    req.user = await users.findOne(query);
    next();
  } catch (error) {
    return res.status(401).send({ error: "Unauthorized" });
  }
};

// 1. Role-based Authorization Middleware (RBAC)
const authorize = (...roles) => (req, res, next) => {
  if (req.user?.role === "admin" || roles.includes(req.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden: Access denied" });
};

// 2. Resource Ownership Guard Middleware
const checkJobOwnership = async (req, res, next) => {
  const jobId = req.params.id || req.query.jobId;

  // If no specific job is targeted or user is admin, allow
  if (!jobId || req.user?.role === "admin") {
    return next();
  }

  const query = ObjectId.isValid(jobId) ? { _id: new ObjectId(jobId) } : { _id: jobId };
  const job = await jobsCollection.findOne(query);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const isOwner =
    job.recruiterEmail === req.user?.email ||
    job.recruiterId === (req.user?._id?.toString() || req.user?.id);

  if (!isOwner) {
    return res.status(403).json({ error: "Forbidden: You do not own this job" });
  }

  req.job = job;
  next();
};


// ----------------- Base Routes -----------------



app.get("/", (req, res) => {
  res.send("Hireloop server is running");
});

app.get("/users", verifyToken, authorize("admin"), async (req, res) => {
  const result = await users.find({}).sort({ _id: -1 }).toArray();
  res.send(result);
});

app.patch("/users/:id", verifyToken, authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // 1. Whitelist allowed user roles
    const VALID_ROLES = ["seeker", "recruiter", "admin"];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Allowed roles: ${VALID_ROLES.join(", ")}`,
      });
    }

    // 2. Prevent admin from demoting their own account
    const currentAdminId = req.user?._id?.toString() || req.user?.id;
    if (currentAdminId === id && role !== "admin") {
      return res.status(400).json({ error: "Admins cannot demote their own account" });
    }

    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await users.updateOne(filter, {
      $set: { role, updatedAt: new Date() },
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

// Check single user premium status
app.get("/users/:id/premium", verifyToken, async (req, res) => {
  try {
    const targetUserId = req.params.id === "me" ? (req.user._id?.toString() || req.user.id) : req.params.id;
    const targetEmail = req.query.email || req.user.email;

    // Regular users can only check their own status; admin can check any
    if (req.user?.role !== "admin") {
      const isSelf =
        targetEmail.toLowerCase() === req.user.email.toLowerCase() ||
        targetUserId === (req.user._id?.toString() || req.user.id);
      if (!isSelf) {
        return res.status(403).json({
          success: false,
          premium: false,
          error: "Forbidden: Cannot view other users' premium status",
        });
      }
    }

    const isPremium = req.user.premium === true || (await isUserPremium(targetUserId, targetEmail));
    res.json({ success: true, premium: isPremium });
  } catch (error) {
    res.status(500).json({ success: false, premium: false, error: error.message });
  }
});

// ----------------- Jobs Routes -----------------
app.get("/jobs", async (req, res) => {
  const query = {};
  const { jobType, isRemote, category, search } = req.query;

  if (jobType) query.jobType = jobType;
  if (isRemote) query.isRemote = isRemote === "true";
  if (category) query.category = category;
  if (req.query.recruiterId) query.recruiterId = req.query.recruiterId;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { companyName: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
      { location: { $regex: search, $options: "i" } },
      { responsibilities: { $regex: search, $options: "i" } },
      { requirements: { $regex: search, $options: "i" } },
    ];
  }

  const result = await jobsCollection.find(query).sort({ _id: -1 }).toArray();
  res.send(result);
});

app.get("/jobs/:id", async (req, res) => {
  const { id } = req.params;
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  const result = await jobsCollection.findOne(query);
  res.send(result);
});

app.post("/jobs", verifyToken, authorize("recruiter"), async (req, res) => {
  try {
    // 1. Allowed fields whitelist for creating a job
    const ALLOWED_JOB_FIELDS = [
      "title",
      "companyName",
      "companyLogo",
      "category",
      "jobType",
      "type",
      "isRemote",
      "location",
      "salaryMin",
      "salaryMax",
      "salaryFrequency",
      "currency",
      "responsibilities",
      "requirements",
      "deadline",
    ];

    const jobData = {};
    for (const field of ALLOWED_JOB_FIELDS) {
      if (req.body[field] !== undefined) {
        jobData[field] = req.body[field];
      }
    }

    // 2. Enforce server-controlled identity, status, and timestamps
    jobData.recruiterEmail = req.user.email;
    jobData.recruiterId = req.user._id?.toString() || req.user.id;
    jobData.status = "Active";
    jobData.applicantsCount = 0;
    jobData.createdAt = new Date().toISOString();

    const result = await jobsCollection.insertOne(jobData);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to create job", error: error.message });
  }
});

app.put("/jobs/:id", verifyToken, authorize("recruiter", "admin"), checkJobOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };

    // Allowed fields whitelist using simple array and for-loop
    const ALLOWED_JOB_FIELDS = [
      "title",
      "companyName",
      "companyLogo",
      "category",
      "jobType",
      "type",
      "isRemote",
      "location",
      "salaryMin",
      "salaryMax",
      "salaryFrequency",
      "currency",
      "responsibilities",
      "requirements",
      "deadline",
      "status",
    ];

    const updateData = {};
    for (const field of ALLOWED_JOB_FIELDS) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }
    updateData.updatedAt = new Date();

    const result = await jobsCollection.updateOne(filter, { $set: updateData });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to update job", error: error.message });
  }
});

app.delete("/jobs/:id", verifyToken, authorize("recruiter"), checkJobOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await jobsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete job", error: error.message });
  }
});

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
