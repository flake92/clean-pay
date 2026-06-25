import { bffError, bffJson } from "@/backend/http/bff-response";
import { deletePasskey } from "@/backend/auth/passkeys";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    return bffJson(await deletePasskey(id));
  } catch (error) {
    return bffError(error);
  }
}
