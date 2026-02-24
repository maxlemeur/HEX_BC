import { z } from "zod";

import {
  TakeoffExchangeSchema,
  TakeoffItemSchema,
  TakeoffMetadataSchema,
  TakeoffTableSchema,
  TakeoffWarningSchema,
} from "@/lib/takeoff/schemas";

export type TakeoffExchange = z.infer<typeof TakeoffExchangeSchema>;
export type TakeoffItem = z.infer<typeof TakeoffItemSchema>;
export type TakeoffTable = z.infer<typeof TakeoffTableSchema>;
export type TakeoffWarning = z.infer<typeof TakeoffWarningSchema>;
export type TakeoffMetadata = z.infer<typeof TakeoffMetadataSchema>;
