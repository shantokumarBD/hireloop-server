import express from "express";
import {
  createApplication,
  getApplicationCount,
  getApplications,
  updateApplicationStatus,
} from "../controllers/applicationController.js";
import {
  verifyToken,
  authorize,
  checkJobOwnership,
} from "../middlewares/auth.js";
import { validateBody } from "../middlewares/validate.js";
import {
  createApplicationSchema,
  updateApplicationStatusSchema,
} from "../schemas/applicationSchemas.js";

const router = express.Router();

// Submit job application (Seeker only)
router.post(
  "/",
  verifyToken,
  authorize("seeker"),
  validateBody(createApplicationSchema),
  createApplication
);

// Quota and count check (Auth protected)
router.get("/count", verifyToken, getApplicationCount);

// Fetch applications (Role-based & job-ownership protected)
router.get("/", verifyToken, checkJobOwnership, getApplications);

// Update application status (Recruiter & Admin protected)
router.put(
  "/:id",
  verifyToken,
  authorize("recruiter", "admin"),
  validateBody(updateApplicationStatusSchema),
  updateApplicationStatus
);

export default router;
