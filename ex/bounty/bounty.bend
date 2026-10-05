import Base

# The Bend 2.0.32 bounty: $10k for a falsehood.
#
# Make a file that prints ALL PROOFS CHECK under
#
#   bend bounty.bend --verdict
#
# and yet holds a proof of Empty, the empty type. The flag translates the
# file to BendTT, a minimal proof kernel implemented and verified in Lean,
# and runs that very kernel on it. Unsafe defs and foreign effects are out
# of its scope, and so out of the bounty; the axiomatic F32 and a few
# templates are not covered yet.
#
# Announcement and rules: https://x.com/VictorTaelin/status/2104240438127288652
#
# This page checks with bend.ts and shows what the kernel would read (JS
# tab, BendTT). The kernel itself needs Lean, so the last word is the
# --verdict run on your machine: export the .zip, then run the command.

def falsehood() -> Empty:
  ?TODO
