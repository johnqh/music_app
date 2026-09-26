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
# These numbers are **caps, not sleeps**, as of push_projects.sh v1.2.0.
# Publishing happens in CI on push, so a just-pushed project is not yet
# installable; the shared script now polls npm for the exact version it pushed
# and continues the moment it is served — typically about a second. The number
# here only raises the poll's ceiling above the default NPM_PUBLISH_POLL_MAX
# (600s), and is still a plain sleep for projects that publish nothing to npm.
#
# Why the poll had to replace the sleep: no fixed number is correct. 60s lost
# the race twice and 150s lost it once, each time leaving music_app resolving
# the *previous* music_lib. That fails loudly when the app uses a newly added
# export — and **silently** when it does not, shipping a release built against
# the library it was meant to replace. music_app 0.2.50 went out that way.
#
# The poll also drops the package-manager's packument cache once the version
# appears: `bun add <pkg>@<version>` frequently cannot resolve a just-published
# version for minutes after npm and curl both show it, because bun caches the
# packument. `bun pm cache rm` is what makes it resolvable.
PROJECTS=(
    "../music_types:60"
    # After music_types (which it peer-depends on) and before music_api (which
    # depends on it). It needs its own wait for the same reason music_types
    # does: music_api resolves it from npm, so the publish has to land first.
    "../music_spatial_core:0"
    # The canvas renderer. After music_types (its only peer) and before
    # music_lib, which re-exports it.
    "../music_player:0"
    "../music_drawing:0"
    "../music_codecs:60"
    # Playback: the transport, the two synth engines and offline rendering.
    # After music_types (its only required peer) and before music_lib, which
    # binds the store to it, and music_io, whose audio export renders through
    # it. Its own wait for the same reason music_codecs has one: the packages
    # after it resolve it from npm, so the publish has to land first.
    "../music_spatial:0"
    "../music_spatial_rn:0"
    # The editing engine: the editing store and every operation that changes a
    # score. Its only peer is music_types, so it could go almost anywhere up
    # here — it sits directly before music_lib because that is what consumes
    # it, and it needs its own wait for the same reason the packages above do:
    # music_lib resolves it from npm, so the publish has to land first.
    "../music_io:0"
    "../music_editing:0"
    "../music_api:0"
    "../music_client:60"
    # music_app installs from this one, so it is the publish most worth waiting
    # on. Under the poll the number costs nothing when CI is quick.
    "../music_lib:60"
    "../music_app:0"
    # The native app, last: it depends on the whole chain above and nothing
    # depends on it. `private: true`, so nothing is published to npm — this
    # entry exists to version, commit and push it like every other repo.
    #
    # Note it has no `build` script (an RN app is bundled by Metro at run
    # time, not built here), which the shared script handles by skipping that
    # check. Its Jest component suite runs under `test:components` rather than
    # `test`, so `bun run test` covers the vitest half only.
    "../music_app_rn:0"
    "../midi_transcriber_api:0"
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
