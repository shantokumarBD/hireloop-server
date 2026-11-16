import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Route modules
import webhookRoutes from "./routes/webhookRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";

const app = express();

// Trust reverse proxy in production (e.g., Render, Railway, Vercel, Nginx)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// 1. Security Headers via Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// 2. Dynamic CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, automated tests) or whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy: Origin not allowed"));
    },
    credentials: true,
  })
);

// 3. Rate Limiting to prevent brute-force and DDoS
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(apiLimiter);

// 4. Stripe Webhook (MUST be mounted before express.json() for raw buffer)
app.use("/webhook", webhookRoutes);

// 5. Standard JSON body parser
app.use(express.json());

// 6. API Routers
app.use("/", userRoutes);
app.use("/jobs", jobRoutes);
app.use("/applications", applicationRoutes);
app.use("/payment", paymentRoutes);

export default app;
