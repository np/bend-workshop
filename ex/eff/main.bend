import Base

# A foreign effect: the body is the host file that implements it.
# The host file registers a function under the def with io_eff.
def Clock.year() -> IO(U32):
  import "./clock.js"

def main() -> IO(Unit):
  do IO<Unit>:
    y : U32 <- Clock.year()
    IO.print("The year is " ++ U32.show(y))
