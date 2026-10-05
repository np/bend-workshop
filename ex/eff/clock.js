// Runs beside the compiled program, in a closure of its own.
// A U32 is a JS number; a String a string; a Nat a BigInt.
function clock_year() {
  return new Date().getFullYear();
}

// Registers the function under the def, as every effect in Base does.
io_eff(CID(Clock.year), clock_year);
