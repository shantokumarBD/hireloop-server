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
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await users.updateOne(filter, {
      $set: { role, updatedAt: new Date() },
    });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update user", error: error.message });
  }
});

// Check single user premium status
app.get("/users/:id/premium", async (req, res) => {
  try {
    const isPremium = await isUserPremium(req.params.id, req.query.email);
    res.send({ success: true, premium: isPremium });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, premium: false, error: error.message });
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
    const jobData = {
      ...req.body,
      recruiterEmail: req.user.email,
      recruiterId: req.user._id?.toString() || req.user.id || req.body.recruiterId,
    };
    const result = await jobsCollection.insertOne(jobData);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to create job", error: error.message });
  }
});

app.put("/jobs/:id", verifyToken, authorize("recruiter"), checkJobOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await jobsCollection.updateOne(filter, { $set: req.body });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update job", error: error.message });
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
    const application = {
      ...req.body,
      userId: req.user._id?.toString() || req.user.id || req.body.userId,
      seekerEmail: req.user.email || req.body.seekerEmail,
    };
    const { userId, seekerEmail: email, jobId } = application;

    const seekerConditions = [];
    if (userId && userId !== "undefined") {
      if (ObjectId.isValid(userId))
        seekerConditions.push({ userId: new ObjectId(userId) });
      seekerConditions.push({ userId });
    }
    if (email && email !== "undefined")
      seekerConditions.push({ seekerEmail: email });

    if (seekerConditions.length > 0) {
      const isPremium = await isUserPremium(userId, email);

      // Limit of 3 free applications for non-premium users
      if (!isPremium) {
        const count = await applicationsCollection.countDocuments({
          $or: seekerConditions,
        });
        if (count >= 3) {
          return res.status(403).json({
            success: false,
            limitReached: true,
            count,
            error: "APPLICATION_LIMIT_REACHED",
            message:
              "You have reached the maximum limit of 3 free applications. Please upgrade to Pro.",
            redirectUrl: "/dashboard/job-seeker/billing",
          });
        }
      }

      // Prevent duplicate application for the same job
      if (jobId) {
        const alreadyApplied = await applicationsCollection.findOne({
          jobId,
          $or: seekerConditions,
        });
        if (alreadyApplied) {
          return res.status(400).json({
            success: false,
            alreadyApplied: true,
            error: "ALREADY_APPLIED",
            message: "You have already applied for this job.",
          });
        }
      }
    }

    const result = await applicationsCollection.insertOne(application);
    res.send(result);
  } catch (error) {
    console.error("Error creating application:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to submit application" });
  }
});

app.get("/applications/count", async (req, res) => {
  try {
    const { userId, email } = req.query;
    const seekerConditions = [];

    if (userId && userId !== "undefined") {
      if (ObjectId.isValid(userId))
        seekerConditions.push({ userId: new ObjectId(userId) });
      seekerConditions.push({ userId });
    }
    if (email && email !== "undefined")
      seekerConditions.push({ seekerEmail: email });

    if (seekerConditions.length === 0) {
      return res.json({
        count: 0,
        limit: 3,
        limitReached: false,
        remaining: 3,
      });
    }

    const isPremium = await isUserPremium(userId, email);
    const count = await applicationsCollection.countDocuments({
      $or: seekerConditions,
    });

    res.json({
      count,
      isPremium,
      limit: isPremium ? "unlimited" : 3,
      limitReached: isPremium ? false : count >= 3,
      remaining: isPremium ? 999999 : Math.max(0, 3 - count),
    });
  } catch (error) {
    console.error("Error getting applications count:", error);
    res
      .status(500)
      .json({ count: 0, limit: 3, limitReached: false, remaining: 3 });
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

// ----------------- Stripe Payment Verification -----------------
app.post("/payment", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res
        .status(400)
        .send({ success: false, message: "Missing sessionId" });
    }

    // Retrieve checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const { status, payment_status, customer_email, metadata, payment_intent } =
      session;

    if (status === "complete" || payment_status === "paid") {
      const email = customer_email || session?.customer_details?.email;
      const userId = metadata?.userId;

      // 1. Insert payment record if not already recorded
      const existingPayment = await paymentCollection.findOne({ sessionId });
      if (!existingPayment) {
        await paymentCollection.insertOne({
          sessionId,
          status,
          payment_status,
          customer_email: email || null,
          userId: userId || null,
          payment_intent,
          premium: true,
          plan: "Hireloop Pro",
          amount: 20.0,
          currency: "usd",
          payment_date: new Date(),
        });
      }

      // 2. Mark user as premium in database
      const userConditions = [];
      if (userId && userId !== "undefined") {
        if (ObjectId.isValid(userId))
          userConditions.push({ _id: new ObjectId(userId) });
        userConditions.push({ _id: userId }, { id: userId });
      }
      if (email) userConditions.push({ email });

      if (userConditions.length > 0) {
        await users.updateOne(
          { $or: userConditions },
          { $set: { premium: true } },
        );
      }

      return res.send({
        success: true,
        message: "Payment verified successfully",
      });
    }

    res.send({ success: false, message: "Payment not completed" });
  } catch (error) {
    console.error("Payment error:", error);
    res.status(500).send({ success: false, message: error.message });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Hireloop server listening on port ${port}`);
});
