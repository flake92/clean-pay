import type { ChangeQuote } from "@/shared/domain/plan-change";

export interface ChangeQuoteReader {
  loadChangeQuote(planCode: string, durationDays: number): Promise<ChangeQuote>;
}

/**
 * The plan-change credit shown before paying. Best effort: an older Remnashop,
 * an unknown plan or a provider error leaves the page without the block.
 */
export async function loadChangeQuote(
  reader: ChangeQuoteReader,
  planCode: string | null,
  durationDays: string | null,
): Promise<ChangeQuote | null> {
  const days = Number(durationDays);
  if (!planCode || durationDays === null || !Number.isSafeInteger(days) || days < 0) return null;
  try {
    const quote = await reader.loadChangeQuote(planCode, days);
    return quote.mode === "NEW" ? null : quote;
  } catch {
    return null;
  }
}
