from pathlib import Path

p = Path("/opt/remnashop/.env")
target = "https://oplata.clear-vpn.org/auth/telegram/webapp"
updates = {
    "WEB_ENABLED": "true",
    "WEB_CABINET_URL": target,
    "BOT_MINI_APP": target,
}

lines = p.read_text().splitlines()
seen = set()
new_lines = []

for line in lines:
    if line and not line.lstrip().startswith("#") and "=" in line:
        key, _ = line.split("=", 1)
        if key in updates:
            line = f"{key}={updates[key]}"
            seen.add(key)
    new_lines.append(line)

for key, value in updates.items():
    if key not in seen:
        new_lines.append(f"{key}={value}")

p.write_text("\n".join(new_lines) + "\n")
print("updated")
