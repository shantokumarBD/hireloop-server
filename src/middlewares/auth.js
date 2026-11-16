import { ObjectId } from "mongodb";
import {
  users,
  sessions,
  jobsCollection,
  paymentCollection,
} from "../config/db.js";

// Helper: Check if a user has active premium status (from user doc or payment history)
export async function isUserPremium(userId, email) {
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
        { projection: { premium: 1 } }
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

// 1. Verify user using Better Auth session
export const verifyToken = async (req, res, next) => {
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

    if (!req.user) {
      return res.status(401).send({ error: "User not found" });
    }

    next();
  } catch (error) {
    return res.status(401).send({ error: "Unauthorized" });
  }
};

// 2. Role-based Authorization Middleware (RBAC)
export const authorize = (...roles) => (req, res, next) => {
  if (req.user?.role === "admin" || roles.includes(req.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden: Access denied" });
};

// 3. Resource Ownership Guard Middleware
export const checkJobOwnership = async (req, res, next) => {
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
