import express from "express";
import { verifyPayment } from "../controllers/paymentController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validateBody } from "../middlewares/validate.js";
import { verifyPaymentSchema } from "../schemas/paymentSchemas.js";

const router = express.Router();

// Verify and record Stripe checkout session
router.post("/", verifyToken, validateBody(verifyPaymentSchema), verifyPayment);

export default router;
