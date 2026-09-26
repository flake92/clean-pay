# Remnawave subscription URL origins

Subscription URLs behave like bearer credentials. Clean Pay therefore opens a
URL returned by Remnawave only when its exact origin is listed in
`REMNAWAVE_SUBSCRIPTION_ORIGINS`.

Configure a comma-separated list of origins (scheme, host and optional port,
without a path):

```dotenv
REMNAWAVE_SUBSCRIPTION_ORIGINS=https://sub.example.com
```

Production accepts only public HTTPS origins. Returned URLs containing
`user:password@host` credentials, a different scheme, host or port are
discarded. For local development, HTTP is accepted only for an explicitly
allowlisted numeric loopback origin; public HTTP origins remain forbidden.
