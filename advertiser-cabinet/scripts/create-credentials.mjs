import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/auth.mjs";

function password(length = 24) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";
  const bytes = randomBytes(length);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

const login = process.argv[2]?.trim();
const role = process.argv[3]?.trim() || "advertiser";
const campaignIds = (process.argv[4] || "").split(",").map((item) => item.trim()).filter(Boolean);

if (!login || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(login)) {
  console.error("Usage: npm run credentials -- <login> <admin|advertiser> [campaign-id,...]");
  process.exit(1);
}
if (role !== "admin" && role !== "advertiser") {
  console.error("Role must be admin or advertiser");
  process.exit(1);
}

const generatedPassword = password();
const account = {
  login,
  name: login,
  role,
  passwordHash: hashPassword(generatedPassword),
  campaignIds: role === "admin" ? [] : campaignIds,
};

console.log(`Login: ${login}`);
console.log(`Password: ${generatedPassword}`);
console.log(`Account JSON: ${JSON.stringify(account)}`);
console.log(`Session secret: ${randomBytes(48).toString("base64url")}`);
