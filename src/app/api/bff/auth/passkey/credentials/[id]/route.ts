import { bffError, bffJson } from "@/lib/bff-response";
import { deletePasskey } from "@/server/auth/passkeys";

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
