import express from "express";
import {
  getServerStatus,
  getAllUsers,
  updateUserRole,
  getUserPremiumStatus,
} from "../controllers/userController.js";
import { verifyToken, authorize } from "../middlewares/auth.js";
import { validateBody } from "../middlewares/validate.js";
import { updateUserRoleSchema } from "../schemas/userSchemas.js";

const router = express.Router();

// Base / Root
router.get("/", getServerStatus);

// User Management (Admin protected)
router.get("/users", verifyToken, authorize("admin"), getAllUsers);
router.patch(
  "/users/:id",
  verifyToken,
  authorize("admin"),
  validateBody(updateUserRoleSchema),
  updateUserRole
);

// Premium Status Check (Auth protected)
router.get("/users/:id/premium", verifyToken, getUserPremiumStatus);

export default router;
