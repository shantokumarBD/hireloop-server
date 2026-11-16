import express from "express";
import cors from "cors";

// Route modules
import webhookRoutes from "./routes/webhookRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";

const app = express();

// Global Middlewares
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);

// 1. Stripe Webhook (MUST be mounted before express.json() for raw buffer)
app.use("/webhook", webhookRoutes);

// 2. Standard JSON body parser
app.use(express.json());

// 3. API Routers
app.use("/", userRoutes);
app.use("/jobs", jobRoutes);
app.use("/applications", applicationRoutes);
app.use("/payment", paymentRoutes);

export default app;
