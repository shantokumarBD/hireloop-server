import { ObjectId } from "mongodb";
import { jobsCollection } from "../config/db.js";

// GET /jobs - Public: Fetch all jobs with optional filters
export const getAllJobs = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch jobs", error: error.message });
  }
};

// GET /jobs/:id - Public: Fetch a single job by ID
export const getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await jobsCollection.findOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch job", error: error.message });
  }
};

// POST /jobs - Recruiter: Create a new job posting with whitelisted fields
export const createJob = async (req, res) => {
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
};

// PUT /jobs/:id - Recruiter (Owner) / Admin: Update job with whitelisted fields
export const updateJob = async (req, res) => {
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
};

// DELETE /jobs/:id - Recruiter (Owner): Delete a job
export const deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await jobsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete job", error: error.message });
  }
};
