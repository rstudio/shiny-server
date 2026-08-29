---
name: memory-bank
description: |
  Discover, search, and maintain the memory-bank documentation directory.

  Load this skill and read memory files BEFORE starting an Explore subagent.

  Read memory files when: exploring architecture docs, finding relevant
  memory-bank files, updating or creating memory-bank documents, or searching
  project documentation.

  Create memory files when: designing new architectural patterns or broad
  features, after implementing significant changes to core architecture.

  Maintain and update memory files after open-ended code exploration.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

# Memory Bank

The `memory-bank/` directory contains architectural documentation for Shiny Server. Each file covers a specific subsystem or design pattern. All files have YAML frontmatter with `title` and `description` fields.

## Listing documents

Run the listing script to see all documents with their titles and descriptions:

```bash
node ${SKILL_DIR}/scripts/list_memory_bank.mjs
```

Replace `${SKILL_DIR}` with the path to this skill's directory.

## Searching

**Search with query expansion** — use Grep to search file contents, expanding your search terms into synonyms, component names, and abbreviations.

For example, when searching for "how a request reaches an R process":
- Search for: `proxy`, `router`, `AppSpec`, `scheduler`, `worker`, `SockJS`

## Updating documents

Update memory-bank files when:
- Discovering new architectural patterns that should be documented
- After implementing significant changes to core architecture
- When the user requests an update
- When important context needs to be added or clarified

When updating, keep the YAML frontmatter `title` and `description` in sync with the document content.

## Creating new documents

When creating a new memory-bank file:
1. Use **camelCase** naming (e.g., `newFeatureSystem.md`)
2. Add YAML frontmatter with `title` and `description`
3. Add a corresponding entry in `CLAUDE.md` under "Key Architecture Documents"

## What belongs here

Memory-bank documents record the **"why"** — design decisions, invariants,
gotchas, and the shape of a subsystem — not a line-by-line restatement of the
code. Prefer pointers into the source (`lib/proxy/http.js:120`) over pasted
code. If a fact is trivially discoverable by reading one function, it probably
does not belong.
