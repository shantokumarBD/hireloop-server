import express from "express";
import { verifyPayment } from "../controllers/paymentController.js";
import { verifyToken } from "../middlewares/auth.js";

const router = express.Router();

// Verify and record Stripe checkout session
router.post("/", verifyToken, verifyPayment);

export default router;
