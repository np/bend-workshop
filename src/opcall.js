  // Operators and calls
  // ===================
  // (x + y * 3n : Nat) and Nat.add(x, Nat.mul(y, 3n)) are one term: the
  // parser makes the first into the second (parse_term_ops, then
  // parse_term_ns in bend.ts). In parentheses, ": T" names the operators'
  // namespace, T.verb for the head of T; it is not a type the term is
  // checked against (that is {e : T}). So (a < b : Nat) is Nat.is_lt(a, b),
  // a Bool. The walk that hands T down goes through the T.verb operators and
  // through && || ++, not into calls or <> & |. Either form becomes the other
  // here with the table's precedences and associativity, read from bend.ts;
  // literals stay as they are (3 is a U32 in either form, 3n a Nat).

  // def -> operator, for the way back: the fixed defs first, since
  // Bool.and is both && and (.&. : Bool), and && needs no annotation.
  function op_back() {
    const fixed = {};
    const verbs = {};
    for (const [op, [, , def]] of Object.entries(Core.INFIX)) {
      if (def === "") {
        continue;
      }
      if (def.startsWith(".")) {
        verbs[def.slice(1)] = op;
      } else if (fixed[def] === undefined) {
        fixed[def] = op;
      }
    }
    return { fixed, verbs };
  }

  const OP_WALKED = new Set(["Bool.and", "Bool.or", "String.append"]);

  // The text between top-level operators: atoms and the operators between
  // them, operators being the table's, with a space on each side.
  function op_tokens(s) {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\"" || c === "'") {
        const q = c;
        for (i++; i < s.length && s[i] !== q; i++) {
          if (s[i] === "\\") {
            i++;
          }
        }
        continue;
      }
      if ("([{".includes(c)) {
        depth++;
      } else if (")]}".includes(c)) {
        depth--;
      } else if (depth === 0 && /\s/.test(c)) {
        let j = i;
        while (j < s.length && /[ \t]/.test(s[j])) {
          j++;
        }
        for (const n of [3, 2, 1]) {
          const op = s.slice(j, j + n);
          if (Core.INFIX[op] !== undefined && /\s/.test(s[j + n] || "")) {
            out.push({ atom: s.slice(from, i).trim() }, { op });
            i = j + n - 1;
            from = j + n;
            break;
          }
        }
      }
    }
    out.push({ atom: s.slice(from).trim() });
    return out;
  }

  // A tree of operators over atoms, as parse_term_ops climbs: an operator
  // binds tighter than one of lower precedence; at equal precedence the
  // left one wins unless the operator is right-associative.
  function op_tree(s) {
    const toks = op_tokens(s);
    let i = 0;
    const atom = () => {
      const tk = toks[i++];
      if (!tk || tk.atom === undefined || tk.atom === "") {
        throw new Error("op_shape");
      }
      return op_atom(tk.atom);
    };
    const climb = (min) => {
      let left = atom();
      while (i < toks.length && toks[i].op !== undefined) {
        const op = toks[i].op;
        const [prec, right, def] = Core.INFIX[op];
        if (prec < min) {
          break;
        }
        if (def === "") {
          throw new Error("op_kind");
        }
        i++;
        left = { op, l: left, r: climb(right ? prec : prec + 1) };
      }
      return left;
    };
    const tree = climb(0);
    if (i !== toks.length) {
      throw new Error("op_shape");
    }
    return tree;
  }

  // An atom; a plain (..) around operators is a group of the same walk.
  function op_atom(text) {
    if (text[0] === "(" && close_of(text, 0) === text.length - 1) {
      const inner = text.slice(1, -1).trim();
      if (top_split(inner, " : ").length === 1 && split_top(inner).length === 1
        && op_tokens(inner).some((x) => x.op !== undefined)) {
        return { group: op_tree(inner) };
      }
    }
    return { atom: text };
  }

  // Operators to calls. ns: the namespace head, or null with none.
  function op_calls(node, ns) {
    if (node.atom !== undefined) {
      return node.atom;
    }
    if (node.group !== undefined) {
      return op_calls(node.group, ns);
    }
    const def = Core.INFIX[node.op][2];
    const walked = def.startsWith(".") || OP_WALKED.has(def);
    const a = op_calls(node.l, walked ? ns : null);
    const b = op_calls(node.r, walked ? ns : null);
    if (def.startsWith(".")) {
      if (ns === null) {
        throw new Error("op_needs_ns");
      }
      return ns + def + "(" + a + ", " + b + ")";
    }
    return def === "Con" ? "Con{" + a + ", " + b + "}" : def + "(" + a + ", " + b + ")";
  }

  // Calls to a tree: a two-argument call to an operator's def becomes the
  // operator, its arguments in turn; an annotated group of the same
  // namespace among them is opened up. Anything else is an atom.
  function call_tree(text, back) {
    const s = text.trim();
    const m = /^([A-Za-z_][\w.]*)\s*([({])/.exec(s);
    if (m !== null && close_of(s, m[0].length - 1) === s.length - 1) {
      const args = split_top(s.slice(m[0].length, -1));
      const name = m[1];
      if (args.length === 2) {
        let op = null;
        let ns = null;
        if (m[2] === "{") {
          op = name === "Con" ? back.fixed.Con || null : null;
        } else if (back.fixed[name] !== undefined) {
          op = back.fixed[name];
        } else if (name.includes(".")) {
          const dot = name.lastIndexOf(".");
          op = back.verbs[name.slice(dot + 1)] || null;
          ns = op === null ? null : name.slice(0, dot);
        }
        if (op !== null) {
          return { op, ns, l: call_tree(args[0], back), r: call_tree(args[1], back) };
        }
      }
    }
    if (s[0] === "(" && close_of(s, 0) === s.length - 1) {
      const parts = top_split(s.slice(1, -1), " : ");
      if (parts.length > 1) {
        const ns = (/^[A-Za-z_][\w.]*/.exec(parts[parts.length - 1].trim()) || [""])[0];
        try {
          return op_with_ns(op_tree(parts.slice(0, -1).join(" : ").trim()), ns);
        } catch (e) {
          return { atom: s };
        }
      }
    }
    return { atom: s };
  }

  // A tree read from operators, each T.verb operator marked with ns.
  function op_with_ns(node, ns) {
    if (node.atom !== undefined) {
      return node;
    }
    if (node.group !== undefined) {
      return op_with_ns(node.group, ns);
    }
    const def = Core.INFIX[node.op][2];
    const walked = def.startsWith(".") || OP_WALKED.has(def);
    return { op: node.op, ns: def.startsWith(".") ? ns : null,
      l: walked ? op_with_ns(node.l, ns) : node.l, r: walked ? op_with_ns(node.r, ns) : node.r };
  }

  // The namespaces a group written from this node needs: the T.verb
  // operators the walk meets first, through && || ++ (each of those
  // operators then speaks for its own subtree).
  function op_spaces(node, out) {
    if (node.op === undefined) {
      return out;
    }
    const def = Core.INFIX[node.op][2];
    if (def.startsWith(".")) {
      out.add(node.ns);
    } else if (OP_WALKED.has(def)) {
      op_spaces(node.l, out);
      op_spaces(node.r, out);
    }
    return out;
  }

  // A tree to operators, with only the parentheses precedence needs; ns is
  // the namespace of the group being written (null outside any). A T.verb
  // operator of another namespace starts a group of its own.
  function op_infix(node, ns) {
    if (node.atom !== undefined) {
      // an atom holding top-level operators would mix with ours
      return op_tokens(node.atom).some((x) => x.op !== undefined) ? "(" + node.atom + ")" : node.atom;
    }
    const def = Core.INFIX[node.op][2];
    if (def.startsWith(".") && node.ns !== ns) {
      return op_group(node);
    }
    const [prec, right] = Core.INFIX[node.op];
    const walked = def.startsWith(".") || OP_WALKED.has(def);
    const side = (child, left) => {
      const inner = walked ? ns : null;
      const text = op_infix(child, inner);
      if (child.op === undefined || (Core.INFIX[child.op][2].startsWith(".") && child.ns !== inner)) {
        return text;
      }
      const [cp] = Core.INFIX[child.op];
      const wrap = cp < prec || (cp === prec && (right ? left : !left));
      return wrap ? "(" + text + ")" : text;
    };
    return side(node.l, true) + " " + node.op + " " + side(node.r, false);
  }

  // A tree as a whole expression: one annotated group when its walk meets
  // one namespace, none when it meets none, a group per namespace else.
  function op_group(node) {
    const spaces = op_spaces(node, new Set());
    if (spaces.size === 1 && (node.op === undefined || Core.INFIX[node.op][2].startsWith(".") || OP_WALKED.has(Core.INFIX[node.op][2]))) {
      const ns = [...spaces][0];
      return "(" + op_infix(node, ns) + " : " + ns + ")";
    }
    return op_infix(node, null);
  }

  // Where the operator at a sits: the annotated group around it (the first
  // ( .. ) out from it whose content ends in : T), else the stretch of the
  // statement, argument or brackets it is in.
  function op_scope(text, a) {
    let depth = 0;
    for (let i = a - 1; i >= 0; i--) {
      const c = text[i];
      if (")]}".includes(c)) {
        depth++;
      } else if ("([{".includes(c)) {
        if (depth > 0) {
          depth--;
          continue;
        }
        const shut = close_of(text, i);
        if (shut < 0) {
          return null;
        }
        const inner = text.slice(i + 1, shut);
        const call = c === "(" && /[\w.]/.test(text[i - 1] || "");
        if (c === "(" && !call) {
          const parts = top_split(inner, " : ");
          if (parts.length > 1) {
            return { from: i, to: shut + 1, expr: parts.slice(0, -1).join(" : ").trim(),
              ns: (/^[A-Za-z_][\w.]*/.exec(parts[parts.length - 1].trim()) || [""])[0] };
          }
          if (split_top(inner).length === 1) {
            continue;   // plain parentheses: the group may be further out
          }
        }
        // a call's argument, an element, a field: the comma-separated slot
        return op_slot(text, i + 1, shut, a);
      }
    }
    return op_slot(text, 0, text.length, a);
  }

  // The comma-separated stretch around a, within from..to, cut at the
  // line and at an assignment or a "return" before it.
  function op_slot(text, from, to, a) {
    let l = a;
    let depth = 0;
    for (; l > from; l--) {
      const c = text[l - 1];
      if (")]}".includes(c)) {
        depth++;
      } else if ("([{".includes(c)) {
        depth--;
      } else if (depth === 0 && (c === "," || c === "\n")) {
        break;
      } else if (depth === 0 && c === "=" && !/[=<>!]/.test(text[l - 2] || "") && text[l] !== "=" && text[l] !== ">") {
        break;
      }
    }
    let r = a;
    depth = 0;
    for (; r < to; r++) {
      const c = text[r];
      if ("([{".includes(c)) {
        depth++;
      } else if (")]}".includes(c)) {
        depth--;
      } else if (depth === 0 && (c === "," || c === "\n")) {
        break;
      }
    }
    let seg = text.slice(l, r);
    const lead = /^\s*(return\s+)?/.exec(seg)[0].length;
    const tail = seg.length - seg.replace(/\s*:?\s*$/, (x) => (x.includes(":") && !/\S/.test(text.slice(r).split("\n")[0]) ? "" : x)).length;
    seg = seg.slice(lead, seg.length - tail).replace(/\s+$/, "");
    return { from: l + lead, to: l + lead + seg.length, expr: seg, ns: null };
  }

  // The call that starts at start (its name), to its closing bracket.
  function call_span(text, start) {
    const m = /^([A-Za-z_][\w.]*)\s*([({])/.exec(text.slice(start));
    if (m === null) {
      return null;
    }
    const shut = close_of(text, start + m[0].length - 1);
    return shut < 0 ? null : { from: start, to: shut + 1, name: m[1] };
  }

  // Out from a call, while the call around it is one an operator stands
  // for too: the whole expression is turned at once.
  function call_outer(text, span, back) {
    let cur = span;
    for (;;) {
      const up = call_at(text, cur.from);
      if (up === null || up.start === undefined) {
        return cur;
      }
      const outer = call_span(text, up.start);
      if (outer === null || outer.to < cur.to || call_tree(text.slice(outer.from, outer.to), back).op === undefined) {
        return cur;
      }
      cur = outer;
    }
  }

  // What each refactor would do here, or null.
  function opcall_plan(text, at) {
    const back = op_back();
    if (at.op !== undefined) {
      const sc = op_scope(text, at.a);
      if (sc === null || sc.expr === "") {
        return null;
      }
      try {
        const out = op_calls(op_tree(sc.expr), sc.ns || null);
        return out === sc.expr ? null : { kind: "calls", from: sc.from, to: sc.to, text: out };
      } catch (e) {
        return { kind: "calls", error: e.message };
      }
    }
    const span = call_span(text, at.start);
    if (span === null || call_tree(text.slice(span.from, span.to), back).op === undefined) {
      return null;
    }
    const whole = call_outer(text, span, back);
    const tree = call_tree(text.slice(whole.from, whole.to), back);
    let out = op_group(tree);
    // operators with no group of their own: parentheses unless the call
    // filled an argument or the whole of a statement
    if (out[0] !== "(" || close_of(out, 0) !== out.length - 1) {
      const before = text.slice(0, whole.from).replace(/[ \t]+$/, "");
      const after = text.slice(whole.to).replace(/^[ \t]+/, "");
      const slot = /[(,]$/.test(before) && /^[),]/.test(after);
      const line = (/(^|\n)\s*(return\s+)?$/.test(before) || /[^=<>!]=$/.test(before)) && /^(\n|$|#)/.test(after);
      if (!slot && !line) {
        out = "(" + out + ")";
      }
    }
    return { kind: "ops", from: whole.from, to: whole.to, text: out };
  }

  // The refactor itself: checked first, written only if the verdict stays.
  async function opcall_apply(plan, file) {
    if (agent_guard()) {
      return;
    }
    if (plan.error) {
      toast(t(plan.error === "op_needs_ns" ? "opc_needs_ns" : "opc_cannot"));
      return;
    }
    const i = state.files.findIndex((x) => x.name === file);
    if (i < 0) {
      return;
    }
    const f = state.files[i];
    const next = f.text.slice(0, plan.from) + plan.text + f.text.slice(plan.to);
    const files = files_map();
    const before = await comp_ask(file, false, files);
    const after = await comp_ask(file, false, { ...files, [file]: next });
    const kind = (r) => (r.ok ? "ok" : r.open ? "open:" + (r.goals || []).length : "err:" + (r.text.split("\n").slice(0, 3).join("|")));
    if (kind(after) !== kind(before) && !(after.ok && !before.ok)) {
      toast(t("opc_changed", after.ok ? r_brief(after) : after.open ? open_brief(after) : err_brief(after)));
      return;
    }
    if (f.text !== state.files[i].text) {
      return;
    }
    if (i !== state.active || view.hub !== null) {
      files_pick(i);
    }
    const keep = work_snapshot();
    ed_rewrite(next);
    const pos = plan.from + plan.text.length;
    ed.ta.setSelectionRange(plan.from, pos);
    ed_reveal();
    toast(t(plan.kind === "calls" ? "opc_done_calls" : "opc_done_ops"), t("undo"), () => work_restore(keep));
  }

  function r_brief(r) {
    return r.text.split("\n")[0];
  }

