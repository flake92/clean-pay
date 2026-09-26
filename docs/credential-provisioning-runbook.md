# Credential provisioning and host-file preflight

Live credentials must be provisioned from the approved secret manager or an
encrypted, short-lived handoff. Do not copy reusable values into the repository,
operator notes, shell arguments, command history, logs, artifacts, backups or
temporary directories.

## Operator workstation

After migrating the provisioning flow, securely retire every legacy plaintext
source. The metadata-only Windows gate fails while any explicitly prohibited
path still exists and never reads its contents:

```powershell
pwsh -NoProfile -File deploy/prod/operator-credential-source-preflight.ps1 `
  -ForbiddenPlaintextPath '<legacy-plaintext-credential-file>'
```

Before release approval, record only the secret-manager item owner, credential
class and expiry. Review the legacy parent-directory effective ACL, synchronized
copies, backups and endpoint-protection history without recording values. Rotate
every affected credential class after the access review; a successful repository
preflight does not prove that copies or backups were removed.

## Remnashop host

The external Remnashop environment must be a regular non-symlink file owned by
the service/deploy identity, mode `0600` or read-only `0400`, below a directory
owned by the same identity with mode `0700` or `0750`. For the documented
root-owned deployment, run from a trusted checkout on the authorized host:

```sh
node deploy/prod/remnashop-env-preflight.mjs <absolute-remnashop-env-path> 0 0
```

The guarded Remnashop rollout paths run this check automatically, before their
first Docker inspection, using `REMNASHOP_ENV_FILE` (default
documented in the production env example) and the numeric
`REMNASHOP_ENV_EXPECTED_UID` /
`REMNASHOP_ENV_EXPECTED_GID` policy (both default to `0`). Correct metadata with
the host's approved configuration-management mechanism; do not print or copy
the file. Then use a disposable unprivileged identity to verify read denial,
review parent-directory membership and host accounts, and rotate potentially
exposed credentials after log/access review.

Repository-side checks cannot close the operational evidence boundary. Release
approval still requires records that the remote metadata was corrected, the
legacy operator source was retired, access/backups were reviewed, and rotations
completed. Records must contain no secret values or reusable fingerprints.
