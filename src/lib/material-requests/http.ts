import { z } from "zod";

import { uuidParamSchema as id } from "@/lib/http/request";

export const projectParamsSchema = z.object({ projectId: id("projectId") });
export const requestParamsSchema = projectParamsSchema.extend({ requestId: id("requestId") });
export const lineParamsSchema = requestParamsSchema.extend({ lineId: id("lineId") });
export const fileParamsSchema = requestParamsSchema.extend({ fileId: id("fileId") });
export const quoteParamsSchema = requestParamsSchema.extend({ quoteId: id("quoteId") });
export const technicianParamsSchema = z.object({ technicianId: id("technicianId") });
