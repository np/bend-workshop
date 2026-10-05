# Pong -- the proofs. Esc quits by computation. last_press is a case
# analysis on the four slot flags, abstracted from the key code (press4).
import Base
import ./main.bend as Game
import ./LAWS.bend as Laws

def Laws.esc_quits(rest, g):
  {==}

def press4(
  b1: Bool, b2: Bool, b3: Bool, b4: Bool, +d1: Bool, +d2: Bool, +w: Bool,
  +s: Bool, +up: Bool, +dn: Bool
) -> {Game.Keys{Game.Pong.set(b1, d2, Game.Pong.set(b1, d1, w)),
      Game.Pong.set(b2, d2, Game.Pong.set(b2, d1, s)),
      Game.Pong.set(b3, d2, Game.Pong.set(b3, d1, up)),
      Game.Pong.set(b4, d2, Game.Pong.set(b4, d1, dn))}
    == Game.Keys{Game.Pong.set(b1, d2, w), Game.Pong.set(b2, d2, s),
      Game.Pong.set(b3, d2, up), Game.Pong.set(b4, d2, dn)} : Game.Pong.Keys}:
  ?body

def Laws.last_press(code, d1, d2, keys):
  match keys:
    case Game.Keys{w, s, up, dn}:
      press4(U32.is_eq(code, 119), U32.is_eq(code, 115),
        U32.is_eq(code, 63232), U32.is_eq(code, 63233), d1, d2, w, s, up, dn)
