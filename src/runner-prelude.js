// What a compiled Bend program expects of its host (process, require("fs"),
// the libc behind io_sys), rebuilt over a browser. __host is {args, env,
// write(fd, text), flush(), exit(code), wait(ms)}.
(function (__host) {
  __host.alive = true;
  var __exit = null;
  var __dec = { 1: new TextDecoder("utf-8"), 2: new TextDecoder("utf-8") };
  var __ERRS = { 2: "No such file or directory", 9: "Bad file descriptor",
    22: "Invalid argument", 38: "Function not implemented (no files or sockets in the browser)",
    45: "Operation not supported", 95: "Operation not supported" };
  function __nosys() {
    var e = new Error("ENOSYS");
    e.errno = -38;
    e.code = "ENOSYS";
    throw e;
  }
  var __fs = {
    writeSync: function (fd, data, at, len) {
      at = at || 0;
      len = len === undefined || len === null ? data.length - at : len;
      if (fd !== 1 && fd !== 2) {
        __nosys();
      }
      if (__exit === null) {
        __host.write(fd, __dec[fd].decode(data.subarray(at, at + len), { stream: true }));
      }
      return len;
    },
    openSync: __nosys, closeSync: function () {}, readSync: __nosys,
    fstatSync: __nosys, statSync: __nosys, readFileSync: __nosys, writeFileSync: __nosys
  };
  var process = {
    argv: ["bend", "main.bend"].concat(__host.args),
    env: __host.env,
    platform: "browser",
    arch: "js",
    exit: function (code) {
      if (__exit === null) {
        __exit = code | 0;
      }
      throw { $: "$EXIT", toString: function () { return ""; } };
    }
  };
  var Buffer = { from: function (x) { return x; } };
  function require(name) {
    if (name === "fs" || name === "node:fs") {
      return __fs;
    }
    throw new Error("require(\"" + name + "\") is not available in the browser");
  }
  var __fail = function () { return -1; };
  globalThis.BEND_IO = undefined;
  globalThis.BEND_SYS = {
    mac: false,
    ptr: function (b) { return b; },
    errno: function () { return 38; },
    strerror: function (code) { return __ERRS[code] || "Error " + code; },
    // io_wait selects on the parked effects: here nothing is ever ready,
    // a timed wait sleeps, and a wait with no deadline can never end.
    select: function (n, r, w, e, tv) {
      if (tv === null) {
        throw "bend: this wait needs a file or a socket, and the browser has neither";
      }
      var ms = Number(tv[0]) * 1000 + Number(tv[1]) / 1000;
      if (ms > 0) {
        __host.flush();
        __host.wait(ms);
      }
      return 0;
    },
    socket: __fail, bind: __fail, listen: __fail, connect: __fail, accept: __fail,
    send: __fail, recv: __fail, read: __fail, pread: __fail, sendto: __fail,
    recvfrom: __fail, close: function () { return 0; }, setsockopt: __fail,
    getsockopt: __fail, fcntl: __fail
  };
  // Display
  // =======
  // A Window in the browser: frames are rasterized here and posted to the
  // page's canvas, and the page's keys and pointer come back as Events. The
  // official IO loop never yields, so a worker running it is deaf; a Window
  // program runs this loop instead, the same one with awaits, so messages
  // land between frames. Only programs that open a Window take this path.
  var __chan = typeof MessageChannel === "function" ? new MessageChannel() : null;
  var __woke = null;
  if (__chan) {
    __chan.port1.onmessage = function () {
      var f = __woke;
      __woke = null;
      if (f) {
        f();
      }
    };
  }
  function __yield() {
    return new Promise(function (done) {
      if (__chan) {
        __woke = done;
        __chan.port2.postMessage(0);
      } else {
        setTimeout(done, 0);
      }
    });
  }
  function __sleep(ms) {
    return new Promise(function (done) { setTimeout(done, ms); });
  }
  function __bool(b) {
    return b === 1 || b === true;
  }
  var __display = {
    wins: {},
    next: 1,
    due_at: 0,
    open: function (title, width, height) {
      var w = Number(width) >>> 0;
      var h = Number(height) >>> 0;
      if (w === 0 || h === 0 || w > 2048 || h > 2048) {
        return { $: "Fail", error: { $: "Tuple", fst: 22,
          snd: "Window.open: a browser window is 1 to 2048 pixels a side" } };
      }
      var id = __display.next++;
      var k = 0;
      while ((1 << k) < w || (1 << k) < h) {
        k++;
      }
      __display.wins[id] = { w: w, h: h, k: k };
      __host.post({ win: { open: id, title: String(title), w: w, h: h } });
      return { $: "Done", value: id };
    },
    title: function (id, title) {
      __host.post({ win: { title: String(title), id: id } });
    },
    close: function (id) {
      delete __display.wins[id];
      __host.post({ win: { close: id } });
    },
    // An Image is a quadtree over 2^k x 2^k: a Qua splits its square in four
    // (tl, tr, bl, br), a Qua under the pixels follows tl, a Pix is 0xRRGGBB.
    show: function (id, image) {
      var win = __display.wins[id];
      if (!win || __host.flying > 2) {
        return;
      }
      var w = win.w;
      var h = win.h;
      var buf = __host.pool.pop();
      if (!buf || buf.byteLength !== w * h * 4) {
        buf = new ArrayBuffer(w * h * 4);
      }
      var px = new Uint32Array(buf);
      var fill = function (t, x0, y0, s) {
        if (x0 >= w || y0 >= h) {
          return;
        }
        while (t !== null && typeof t === "object" && t.$ === "Qua") {
          if (s > 1) {
            var half = s >> 1;
            fill(t.tl, x0, y0, half);
            fill(t.tr, x0 + half, y0, half);
            fill(t.bl, x0, y0 + half, half);
            fill(t.br, x0 + half, y0 + half, half);
            return;
          }
          t = t.tl;
        }
        var c = (t !== null && typeof t === "object" ? Number(t.color) : Number(t)) >>> 0;
        var abgr = (0xFF000000 | ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >>> 16) & 0xFF)) >>> 0;
        var x1 = Math.min(x0 + s, w);
        var y1 = Math.min(y0 + s, h);
        for (var y = y0; y < y1; y++) {
          px.fill(abgr, y * w + x0, y * w + x1);
        }
      };
      fill(image, 0, 0, 1 << win.k);
      __host.flying++;
      __host.post({ frame: { id: id, w: w, h: h, buf: buf } }, [buf]);
    },
    // The next 60 Hz tick: a frame parks until then.
    due: function () {
      __display.due_at = Math.max(performance.now(), __display.due_at + 1000 / 60);
      return __display.due_at;
    },
    // What the page sent since the last frame, in arrival order.
    events: function () {
      var evs = __host.inbox.splice(0);
      var list = { $: "Nil" };
      for (var i = evs.length - 1; i >= 0; i--) {
        var e = evs[i];
        var ev = e[0] === 0 ? { $: "Key", code: e[1] >>> 0, down: __bool(e[2]) }
          : e[0] === 1 ? { $: "Mouse", x: e[1] >>> 0, y: e[2] >>> 0, button: e[3] >>> 0, down: __bool(e[4]) }
          : e[0] === 2 ? { $: "Move", x: e[1] >>> 0, y: e[2] >>> 0 }
          : { $: "Close" };
        list = { $: "Con", head: ev, tail: list };
      }
      return list;
    },
    // io_run (2.0.35), awaiting where io_wait blocked: nothing here is ever
    // readable, so a wait is a deadline or a dead end. As there, a timer
    // due fires even while computations keep the loop busy. rt holds the
    // runtime's own helpers; rt.park keeps the waits in deadline order.
    run: async function (main, rt) {
      var io = { runs: [], live: 0, waits: [] };
      globalThis.BEND_IO = io;
      var tick = performance.now();
      var fire = function () {
        var now = performance.now();
        if (io.waits.length === 0 || !(io.waits[0].at <= now)) {
          return;
        }
        io.waits = io.waits.filter(function (w) {
          var ready = w.at <= now;
          if (ready) {
            rt.push(rt.wake, w, false);
          }
          return !ready;
        });
      };
      try {
        rt.push(rt.loop(main()), function (x) { return { $: "Emit", value: x }; }, true);
        for (;;) {
          if (__host.stopped) {
            return 130;
          }
          if (performance.now() - tick > 10) {
            __host.flush();
            await __yield();
            tick = performance.now();
            fire();
          }
          if (io.runs.length === 0) {
            if (io.live === 0) {
              return 0;
            }
            if (io.waits.length === 0) {
              rt.errs("bend: deadlock: every computation waits on a channel");
              return 1;
            }
            var soon = Infinity;
            for (var i = 0; i < io.waits.length; i++) {
              if (io.waits[i].at !== undefined) {
                soon = Math.min(soon, io.waits[i].at);
              }
            }
            if (soon === Infinity) {
              rt.errs("bend: this wait needs a file or a socket, and the browser has neither");
              return 1;
            }
            __host.flush();
            var ms = soon - performance.now();
            await (ms > 3 ? __sleep(ms - 2) : __yield());
            if (__host.stopped) {
              return 130;
            }
            tick = performance.now();
            fire();
            continue;
          }
          var s = io.runs.shift();
          var op = s.fun(s.arg);
          while (op !== undefined) {
            if (op.$ === "Emit") {
              io.live -= 1;
              break;
            }
            if (op.$ === "Halt") {
              rt.errs(op.message);
              return op.code;
            }
            var need = op.need ? op.need() || {} : {};
            if (need.time || need.read) {
              var it = op;
              var more = function () { return it.run.apply(null, it.args.concat([it.kont])); };
              rt.park(need.read ? it.args[0] : undefined, false, it.kont, more,
                need.read ? undefined : performance.now() + Number(it.args[0]));
              break;
            }
            var x = op.run.apply(null, op.args.concat([op.kont]));
            if (x === undefined) {
              break;
            }
            op = op.kont(x);
          }
        }
      } catch (req) {
        if (req instanceof RangeError) {
          rt.errs("bend: memory fault (machine stack overflow?)");
          return 1;
        }
        if (!req || req.$ !== "$FFI") {
          throw req;
        }
        rt.errs("bend: runtime fail-stop");
        return 1;
      }
    }
  };
  function __program() {
/*__PROGRAM__*/
/*__TAIL__*/
  }
  function __report(e) {
    if (!(e && e.$ === "$EXIT")) {
      __exit = __exit === null ? 1 : __exit;
      __host.write(2, (e instanceof RangeError
        ? "bend: the machine stack overflowed (a deep recursion)"
        : e && e.stack ? String(e.stack) : String(e)) + "\n");
    }
  }
  function __finish() {
    __host.flush();
    __host.exit(__exit === null ? 0 : __exit);
  }
  try {
    __program();
  } catch (e) {
    __report(e);
  }
  if (__host.pending) {
    __host.pending.then(function (code) {
      __exit = __exit === null ? code | 0 : __exit;
    }, __report).then(__finish);
  } else {
    __finish();
  }
})
