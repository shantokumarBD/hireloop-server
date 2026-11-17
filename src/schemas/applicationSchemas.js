import { z } from "zod";

export const createApplicationSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
  companyLogo: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  isRemote: z.boolean().optional(),
  location: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryFrequency: z.string().optional(),
  seekerName: z.string().optional(),
  seekerPhone: z.string().optional(),
  resumeUrl: z.string().optional(),
  coverLetter: z.string().optional(),
});

export const updateApplicationStatusSchema = z.object({
  status: z.enum(
    ["Applied", "Review", "Shortlisted", "Interview", "Offered", "Rejected"],
    {
      errorMap: () => ({
        message:
          "Invalid status. Allowed statuses: Applied, Review, Shortlisted, Interview, Offered, Rejected",
      }),
    }
  ),
});
