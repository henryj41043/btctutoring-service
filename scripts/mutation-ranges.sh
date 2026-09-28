#!/usr/bin/env bash
# Prints the Stryker --mutate value for a PR: only the LINES this branch
# added or changed, as comma-separated `file:start-end` ranges. Mutating a
# whole 1,000-line file for a 20-line edit is what made mutation testing
# take an hour; the lines a PR did not touch were already tested when they
# were written.
#
# Usage: scripts/mutation-ranges.sh <base-ref> [<head-ref>]
set -euo pipefail
BASE="$1"; HEAD="${2:-HEAD}"
EXCLUDE="${MUTATION_EXCLUDE:-\.spec\.ts$|/models/|/schemas/|/dto/|\.module\.ts$|/main\.ts$}"
git diff --name-only --diff-filter=AM "$BASE"..."$HEAD" -- src \
  | grep -E "\.ts$" | grep -vE "$EXCLUDE" \
  | while read -r file; do
      git diff -U0 "$BASE"..."$HEAD" -- "$file" \
        | sed -n "s/^@@ -[0-9,]* +\([0-9]*\),\{0,1\}\([0-9]*\) @@.*/\1 \2/p" \
        | while read -r start count; do
            count="${count:-1}"
            [ "$count" = "0" ] && continue
            echo "$file:$start-$((start + count - 1))"
          done
    done | paste -sd, -
