import Base

# The word for i, given whether 3 and 5 divide it.
def word(i: U32, by3: Bool, by5: Bool) -> String:
  match by3 by5:
    case True{} True{}:
      "FizzBuzz"
    case True{} False{}:
      "Fizz"
    case False{} True{}:
      "Buzz"
    case False{} False{}:
      U32.show(i)

# Recursion must terminate, so the loop counts down a Nat.
def loop(n: Nat, +i: U32) -> IO(Unit):
  match n:
    case 0n:
      IO.pure(Unit, Unit{})
    case 1n+p:
      do IO<Unit>:
        IO.print(word(i, U32.is_eq((i % 3 : U32), 0), U32.is_eq((i % 5 : U32), 0)))
        loop(p, (i + 1 : U32))

def main() -> IO(Unit):
  loop(15n, 1)
