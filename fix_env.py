import re

with open("/opt/clean-pay/.env", "r") as f:
    content = f.read()

content = re.sub(r"TURNSTILE_SITE_KEY=.*", "TURNSTILE_SITE_KEY=14f949e87b4f8e75ed77", content)
content = re.sub(r"TURNSTILE_SECRET_KEY=.*", "TURNSTILE_SECRET_KEY=fab80892ff611e2f7c837007781153d3", content)

with open("/opt/clean-pay/.env", "w") as f:
    f.write(content)

print("done")
