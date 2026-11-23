import { z } from "zod"

export const DaemonInvokePayloadSchema = z.object({
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export const OpenInExcelPayloadSchema = z.object({
  filePath: z.string().min(1),
})

export const OpenInVSCodePayloadSchema = z.object({
  targetPath: z.string().min(1),
  line: z.number().int().positive().optional(),
})

export const OpenExternalPayloadSchema = z.object({
  url: z.string().url(),
})

export type DaemonInvokePayload = z.infer<typeof DaemonInvokePayloadSchema>
export type OpenInExcelPayload = z.infer<typeof OpenInExcelPayloadSchema>
export type OpenInVSCodePayload = z.infer<typeof OpenInVSCodePayloadSchema>
export type OpenExternalPayload = z.infer<typeof OpenExternalPayloadSchema>
