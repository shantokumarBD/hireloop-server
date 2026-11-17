import { z } from "zod";

export const verifyPaymentSchema = z.object({
  sessionId: z.string().min(1, "Missing sessionId"),
});
