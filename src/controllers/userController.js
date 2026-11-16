import { ObjectId } from "mongodb";
import { users } from "../config/db.js";
import { isUserPremium } from "../middlewares/auth.js";

// GET / - Root server status
export const getServerStatus = (req, res) => {
  res.send("Hireloop server is running");
};

// GET /users - Admin: Fetch all users
export const getAllUsers = async (req, res) => {
  try {
    const result = await users.find({}).sort({ _id: -1 }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
  }
};

// PATCH /users/:id - Admin: Update user role with security whitelist
export const updateUserRole = async (req, res) => {
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
};

// GET /users/:id/premium - Check single user premium status
export const getUserPremiumStatus = async (req, res) => {
  try {
    const targetUserId =
      req.params.id === "me"
        ? req.user._id?.toString() || req.user.id
        : req.params.id;
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

    const isPremium =
      req.user.premium === true || (await isUserPremium(targetUserId, targetEmail));
    res.json({ success: true, premium: isPremium });
  } catch (error) {
    res.status(500).json({ success: false, premium: false, error: error.message });
  }
};
