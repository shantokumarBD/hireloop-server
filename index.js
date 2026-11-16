import express from "express";
import cors from "cors";
import "dotenv/config";
import { client } from "./src/config/db.js";

const port = process.env.PORT || 5000;
const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);

// Webhook Routes (MUST be before express.json() to preserve raw body buffer for signature verification)
import webhookRoutes from "./src/routes/webhookRoutes.js";
app.use("/webhook", webhookRoutes);

app.use(express.json());

// ----------------- Base & User Routes -----------------
import userRoutes from "./src/routes/userRoutes.js";
app.use("/", userRoutes);

// ----------------- Jobs Routes -----------------
import jobRoutes from "./src/routes/jobRoutes.js";
app.use("/jobs", jobRoutes);

// ----------------- Applications Routes -----------------
import applicationRoutes from "./src/routes/applicationRoutes.js";
app.use("/applications", applicationRoutes);

// ----------------- Payment Routes -----------------
import paymentRoutes from "./src/routes/paymentRoutes.js";
app.use("/payment", paymentRoutes);

// Start Server
app.listen(port, () => {
  console.log(`Hireloop server listening on port ${port}`);
});
