import express from "express";
import {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
} from "../controllers/jobController.js";
import {
  verifyToken,
  authorize,
  checkJobOwnership,
} from "../middlewares/auth.js";

const router = express.Router();

// Public routes
router.get("/", getAllJobs);
router.get("/:id", getJobById);

// Protected routes
router.post("/", verifyToken, authorize("recruiter"), createJob);
router.put(
  "/:id",
  verifyToken,
  authorize("recruiter", "admin"),
  checkJobOwnership,
  updateJob
);
router.delete(
  "/:id",
  verifyToken,
  authorize("recruiter"),
  checkJobOwnership,
  deleteJob
);

export default router;
