import { z } from "zod";

export const updateUserRoleSchema = z.object({
  role: z.enum(["seeker", "recruiter", "admin"], {
    errorMap: () => ({
      message: "Invalid role. Allowed roles: seeker, recruiter, admin",
    }),
  }),
});
