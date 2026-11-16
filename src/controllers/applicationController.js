import { ObjectId } from "mongodb";
import { applicationsCollection, jobsCollection } from "../config/db.js";
import { isUserPremium } from "../middlewares/auth.js";

// POST /applications - Seeker: Submit application with quota check & duplicate handling
export const createApplication = async (req, res) => {
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
    const isPremium =
      req.user.premium === true || (await isUserPremium(userId, seekerEmail));

    if (!isPremium) {
      const count = await applicationsCollection.countDocuments({ seekerEmail });
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
};

// GET /applications/count - Seeker: Fetch quota and application count status
export const getApplicationCount = async (req, res) => {
  try {
    const seekerEmail = req.user.email;
    const userId = req.user._id?.toString() || req.user.id;
    const isPremium =
      req.user.premium === true || (await isUserPremium(userId, seekerEmail));

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
};

// GET /applications - Seeker (own), Recruiter (specific job), Admin (all)
export const getApplications = async (req, res) => {
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
      return res
        .status(400)
        .json({ error: "jobId query parameter is required for recruiters" });
    }
    // 4. Admin without jobId: allowed to see all applications (query remains {})

    const result = await applicationsCollection.find(query).toArray();
    res.json(result);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Failed to fetch applications", error: error.message });
  }
};

// PUT /applications/:id - Recruiter / Admin: Update application status with whitelist
export const updateApplicationStatus = async (req, res) => {
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

      const userId = req.user?._id?.toString() || req.user.id;
      const isOwner =
        job.recruiterEmail?.toLowerCase() === req.user?.email?.toLowerCase() ||
        job.recruiterId === userId;

      if (!isOwner) {
        return res.status(403).json({
          error: "Forbidden: You do not own the job for this application",
        });
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
};
