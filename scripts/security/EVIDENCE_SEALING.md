# Sanitized evidence directory sealing

`seal-evidence-directory.mjs` creates a new, deterministic inventory manifest for
an existing evidence directory. It never replaces the requested manifest and it
does not modify or delete any pre-existing artifact.

Run it from the repository with two explicit absolute paths:

```text
node scripts/security/seal-evidence-directory.mjs \
  --evidence-root <absolute-existing-evidence-directory> \
  --manifest <absolute-new-manifest-path-within-that-directory>
```

The root may not be the repository/current workspace root or an ancestor of
either. Symbolic links, non-regular entries, unsafe/control-character paths,
empty inventories and configured count/byte limits fail closed. The output is
created last with exclusive `wx` creation and mode `0600`; an existing output is
left untouched.

The fixed bounds are 512 files, 2,048 total inventory entries, 32 directory
levels, 1,024 UTF-8 bytes per relative path, 64 MiB per file and 128 MiB in
aggregate. Zero-byte regular files are valid evidence and are hashed normally.

Manifest paths are relative, case-preserving and use `/` separators. Entries are
sorted by JavaScript's case-sensitive UTF-16 ordinal comparison. Each file stores
only its ordinal, relative path, byte count and lowercase SHA-256; no absolute
path, timestamp or file content is emitted.

The aggregate is SHA-256 over these bytes for every sorted entry, concatenated
without an extra prefix or suffix:

```text
UTF8(relative-path) NUL ASCII(byte-count-in-base-10) NUL
ASCII(lowercase-file-sha256) LF
```

The manifest itself is created after the inventory is verified and is not part
of that inventory or aggregate.
