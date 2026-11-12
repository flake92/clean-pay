import type { GiftsResponse } from "@/shared/domain/gifts";

export interface GiftReader {
  loadGifts(): Promise<GiftsResponse>;
}
