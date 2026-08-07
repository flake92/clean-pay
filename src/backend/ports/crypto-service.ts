export interface CryptoService {
  randomToken(bytes: number): string;
  randomUUID(): string;
  sha256(value: string): string;
  hmacSha256(value: string, secret: string): string;
  safeEqual(left: string, right: string): boolean;
  encryptSecret(value: string, secret: string): string;
  decryptSecret(encrypted: string, secret: string): string;
  jsonBase64Url(value: unknown): string;
  parseJsonBase64Url<T>(value: string): T;
}
