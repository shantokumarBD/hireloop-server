import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { paymentCollection, users } from "../config/db.js";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helper reused by POST /payment & Webhook
export async function recordPaymentAndUpgradeUser(session, fallbackUserId = null) {
  const customerEmail = session.customer_email || session.customer_details?.email;
  const userId = session.metadata?.userId || fallbackUserId;
  const sessionId = session.id;

  // 1. Insert payment record (handle potential duplicate key gracefully)
  const existingPayment = await paymentCollection.findOne({ sessionId });
  if (!existingPayment) {
    try {
      await paymentCollection.insertOne({
        sessionId,
        status: session.status,
        payment_status: session.payment_status,
        customer_email: customerEmail || null,
        userId: userId || null,
        payment_intent: session.payment_intent,
        premium: true,
        plan: "Hireloop Pro",
        amount: session.amount_total ? session.amount_total / 100 : 20.0,
        currency: session.currency || "usd",
        payment_date: new Date(),
      });
    } catch (insertErr) {
      if (insertErr.code !== 11000) {
        throw insertErr;
      }
    }
  }

  // 2. Mark user as premium in database (no $or needed)
  let updated = false;
  if (userId) {
    if (ObjectId.isValid(userId)) {
      const res = await users.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { premium: true, updatedAt: new Date() } }
      );
      if (res.matchedCount > 0) updated = true;
    }
    if (!updated) {
      const res = await users.updateOne(
        { id: userId },
        { $set: { premium: true, updatedAt: new Date() } }
      );
      if (res.matchedCount > 0) updated = true;
    }
  }
  if (!updated && customerEmail) {
    await users.updateOne(
      { email: { $regex: new RegExp(`^${customerEmail}$`, "i") } },
      { $set: { premium: true, updatedAt: new Date() } }
    );
  }

  return { success: true };
}

// POST /payment - Verify Stripe Checkout Session
export const verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "Missing sessionId" });
    }

    // 1. Idempotency check: if payment already recorded, exit early
    const existingPayment = await paymentCollection.findOne({ sessionId });
    if (existingPayment) {
      return res.json({ success: true, message: "Payment already verified" });
    }

    // 2. Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const isPaid = session.status === "complete" || session.payment_status === "paid";

    if (!isPaid) {
      return res.status(400).json({ success: false, message: "Payment not completed" });
    }

    // 3. Verify Stripe session belongs to authenticated user (case-insensitive email)
    const customerEmail = session.customer_email || session.customer_details?.email;
    const metadataUserId = session.metadata?.userId;
    const authUserId = req.user._id?.toString() || req.user.id;

    const emailMatches =
      customerEmail &&
      req.user.email &&
      customerEmail.toLowerCase() === req.user.email.toLowerCase();
    const idMatches = metadataUserId && metadataUserId === authUserId;

    if (!emailMatches && !idMatches) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Stripe session does not belong to your account",
      });
    }

    // 4. Record payment and upgrade user via reusable helper
    await recordPaymentAndUpgradeUser(session, authUserId);

    return res.json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    // Treat duplicate-key error (11000) as already verified
    if (error.code === 11000) {
      return res.json({ success: true, message: "Payment already verified" });
    }
    console.error("Payment error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /webhook/stripe - Stripe signature verified webhook
export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured in .env");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      await recordPaymentAndUpgradeUser(session);
      console.log(`Successfully processed webhook for session: ${session.id}`);
    } catch (err) {
      console.error("Error processing checkout.session.completed:", err);
      return res.status(500).json({ error: "Failed to process payment" });
    }
  }

  res.json({ received: true });
};
