import { labErrorResponse, labOk, readLabChatGptModels, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** The ChatGPT account's models and efforts, read without writing the profile. */
export async function GET() {
  try {
    return labOk(await readLabChatGptModels(await requireTakeoffLabAccess()));
  } catch (error) {
    return labErrorResponse(error);
  }
}
