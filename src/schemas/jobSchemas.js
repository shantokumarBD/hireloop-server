import { z } from "zod";

export const createJobSchema = z.object({
  title: z.string().min(1, "Job title is required"),
  companyName: z.string().optional(),
  companyLogo: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  type: z.string().optional(),
  isRemote: z.boolean().optional(),
  location: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryFrequency: z.string().optional(),
  currency: z.string().optional(),
  responsibilities: z.string().optional(),
  requirements: z.string().optional(),
  deadline: z.string().optional(),
});

export const updateJobSchema = z.object({
  title: z.string().min(1, "Job title must not be empty").optional(),
  companyName: z.string().optional(),
  companyLogo: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  type: z.string().optional(),
  isRemote: z.boolean().optional(),
  location: z.string().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  salaryFrequency: z.string().optional(),
  currency: z.string().optional(),
  responsibilities: z.string().optional(),
  requirements: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(["Active", "Closed", "Draft"]).optional(),
});
