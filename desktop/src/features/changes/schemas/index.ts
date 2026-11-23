import { z } from "zod"

export const diffLineTypeSchema = z.enum(["hunk", "ctx", "add", "del"])

export const diffHunkLineSchema = z.object({
  lineNumber: z.number().int().nullable(),
  type: diffLineTypeSchema,
  mark: z.string(),
  content: z.string(),
})

export const changedFileDiffSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  deleted: z.boolean().optional(),
  ownerBadge: z.string().min(1),
  hint: z.string(),
  accepted: z.boolean().optional(),
  rejected: z.boolean().optional(),
  staged: z.boolean().optional(),
  lines: z.array(diffHunkLineSchema),
})

export const changesStateSchema = z.object({
  branch: z.string().min(1),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(changedFileDiffSchema),
})

export const fileReviewDecisionSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
])

export const commitStagedInputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(3, "Enter a commit message (at least 3 characters)")
    .max(120, "Keep the commit subject under 120 characters"),
})

export const createPrInputSchema = z.object({
  baseBranch: z
    .string()
    .trim()
    .min(1, "Specify a target base branch"),
  headBranch: z
    .string()
    .trim()
    .min(1, "Head branch is required"),
  title: z
    .string()
    .trim()
    .min(3, "Enter a pull request title (at least 3 characters)"),
  summary: z
    .string()
    .trim()
    .min(5, "Enter a short pull request summary (at least 5 characters)"),
})

export type ValidatedCommitStagedInput = z.infer<typeof commitStagedInputSchema>
export type ValidatedCreatePrInput = z.infer<typeof createPrInputSchema>
