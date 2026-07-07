from pathlib import Path

p = Path("/opt/clean-pay/deploy/prod/.env")
lines = p.read_text().splitlines()
values = {}

for line in lines:
    if line and not line.lstrip().startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        values[key] = value

old_public = values.get("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "")
new_lines = []
seen_site_key = False

for line in lines:
    if line.startswith("NEXT_PUBLIC_TURNSTILE_SITE_KEY="):
        continue

    if line.startswith("TURNSTILE_SITE_KEY="):
        current = line.split("=", 1)[1]
        if not current and old_public:
            line = f"TURNSTILE_SITE_KEY={old_public}"
        seen_site_key = True

    new_lines.append(line)

if not seen_site_key and old_public:
    new_lines.append(f"TURNSTILE_SITE_KEY={old_public}")

p.write_text("\n".join(new_lines) + "\n")
print("updated")
