#!/usr/bin/env python3
"""Metadata-only Remnashop credential preflight for hosts without Node.js."""

from __future__ import annotations

import os
import stat
import sys


def fail(message: str) -> None:
    raise ValueError(message)


def numeric_identity(value: str, label: str) -> int:
    if not value.isascii() or not value.isdecimal():
        fail(f"{label} must be a numeric id")
    parsed = int(value, 10)
    if parsed > 2**53 - 1:
        fail(f"{label} is outside the safe integer range")
    return parsed


def validate_identity_and_mode(
    metadata: os.stat_result,
    label: str,
    expected_uid: int,
    expected_gid: int,
    allowed_modes: set[int],
) -> None:
    mode = stat.S_IMODE(metadata.st_mode)
    if metadata.st_uid != expected_uid:
        fail(f"{label} must be owned by uid {expected_uid}")
    if metadata.st_gid != expected_gid:
        fail(f"{label} must be owned by gid {expected_gid}")
    if mode not in allowed_modes:
        expected = " or ".join(f"{candidate:o}" for candidate in sorted(allowed_modes))
        fail(f"{label} must have mode {expected}; actual mode is {mode:o}")


def inspect_path(
    path: str,
    label: str,
    expected_uid: int,
    expected_gid: int,
    allowed_modes: set[int],
    expected_kind: str,
) -> None:
    try:
        before = os.lstat(path)
    except OSError as error:
        fail(f"{label} metadata is unavailable ({error.__class__.__name__})")

    matches_kind = stat.S_ISDIR(before.st_mode) if expected_kind == "directory" else stat.S_ISREG(before.st_mode)
    if stat.S_ISLNK(before.st_mode) or not matches_kind:
        fail(f"{label} must be a regular non-symlink {expected_kind}")
    validate_identity_and_mode(before, label, expected_uid, expected_gid, allowed_modes)

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    if expected_kind == "directory":
        flags |= getattr(os, "O_DIRECTORY", 0)
    descriptor: int | None = None
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        opened_matches_kind = stat.S_ISDIR(opened.st_mode) if expected_kind == "directory" else stat.S_ISREG(opened.st_mode)
        if (
            not opened_matches_kind
            or opened.st_dev != before.st_dev
            or opened.st_ino != before.st_ino
        ):
            fail(f"{label} identity changed during metadata validation")
        validate_identity_and_mode(opened, label, expected_uid, expected_gid, allowed_modes)
    except ValueError:
        raise
    except OSError as error:
        fail(f"{label} could not be opened safely ({error.__class__.__name__})")
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main(args: list[str]) -> None:
    if not 1 <= len(args) <= 3:
        fail("usage: remnashop-env-preflight.py ABSOLUTE_ENV_PATH [EXPECTED_UID [EXPECTED_GID]]")
    path = args[0]
    expected_uid = numeric_identity(args[1] if len(args) > 1 else "0", "expected uid")
    expected_gid = numeric_identity(args[2] if len(args) > 2 else "0", "expected gid")
    if not os.path.isabs(path):
        fail("Remnashop env path must be absolute")
    inspect_path(
        os.path.dirname(path),
        "Remnashop env directory",
        expected_uid,
        expected_gid,
        {0o700, 0o750},
        "directory",
    )
    inspect_path(
        path,
        "Remnashop env file",
        expected_uid,
        expected_gid,
        {0o400, 0o600},
        "file",
    )
    print("Remnashop environment-file metadata passed.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError) as error:
        print(f"Remnashop environment-file preflight failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
