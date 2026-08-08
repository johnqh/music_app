#!/bin/bash

# push_all.sh - Project-specific configuration for push_projects.sh
#
# Defines the music-family projects in dependency order and sources the
# reusable push_projects.sh script from the workflows repo.
#
# Usage:
#   ./push_all.sh                              # Update deps and process only projects with changes
#   ./push_all.sh --force                      # Force version bump on all projects
#   ./push_all.sh --subpackages                # Also process sub-packages in /packages directories
#   ./push_all.sh --starting-project <name>    # Skip projects until reaching <name>
#   ./push_all.sh --help                       # Show help message

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Define projects in dependency order with wait times
# Format: "relative_path:wait_after_in_seconds"
#
# Wait times let CI/CD finish publishing to npm before dependent packages
# fetch the new version. music_api is private (never published) and
# music_app is the terminal consumer, so neither needs a wait.
#
# 150s, not 60s: publishing happens in CI on push, and 60s has lost the race
# more than once — music_app then installs the *previous* music_lib and fails
# typecheck on exports that exist in the source it was just built against. The
# failure looks like a code error and is not one.
#
# A poll ("wait until npm serves the version we just pushed") would be strictly
# better than any fixed sleep, but the sleep lives in the shared
# ../workflows/scripts/push_projects.sh, which building_blocks and sudojo_app
# also source — so that change belongs there, deliberately, not as a side
# effect of a music_app run.
#
# Note also that `bun add <pkg>@<version>` frequently cannot resolve a
# just-published version for minutes after npm and curl both show it; `bun
# update` resolves it where `bun add` and `bun install` do not.
PROJECTS=(
    "../music_types:150"
    "../music_client:150"
    "../music_io:0"
    # music_api after music_lib: the job runner applies generated fragments
    # with music_lib's commands, so the backend is now a consumer of the
    # domain library rather than only of music_types.
    "../music_lib:150"
    "../music_api:0"
    "../music_app:0"
)

# Source reusable script: prefer local workflows repo, fall back to GitHub
LOCAL_SCRIPT="$(cd "$BASE_DIR" && pwd)/../workflows/scripts/push_projects.sh"
if [ -f "$LOCAL_SCRIPT" ]; then
    source "$LOCAL_SCRIPT"
else
    PUSH_SCRIPT=$(mktemp)
    trap "rm -f $PUSH_SCRIPT" EXIT
    if ! curl -fsSL "https://raw.githubusercontent.com/johnqh/workflows/main/scripts/push_projects.sh" -o "$PUSH_SCRIPT"; then
        echo "Error: Failed to download push_projects.sh from GitHub"
        exit 1
    fi
    source "$PUSH_SCRIPT"
fi

# Parse command-line arguments
parse_args "$@"

# Run the push process
run_push_projects "$BASE_DIR" "${PROJECTS[@]}"
