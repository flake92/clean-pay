import { hashPassword } from "../src/auth.mjs";

const password = process.argv[2];
if (!password || password.length < 12 || password.length > 256) {
  console.error("Usage: node scripts/hash-password.mjs <password-with-at-least-12-characters>");
  process.exit(1);
}
console.log(hashPassword(password));
