import express from "express";
import { handleStripeWebhook } from "../controllers/paymentController.js";

const router = express.Router();

// Stripe Webhook Endpoint (uses raw body for signature verification)
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

export default router;
