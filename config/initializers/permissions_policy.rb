Rails.application.configure do
  config.action_dispatch.default_headers["Permissions-Policy"] = [
    "camera=()",
    "geolocation=()",
    "microphone=()",
    "payment=()",
    "usb=()",
    "clipboard-read=(self)",
    "clipboard-write=(self)",
    "publickey-credentials-get=(self)"
  ].join(", ")
end
