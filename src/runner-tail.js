// The workshop's display: these declarations follow the compiled program, so
// they win over its own io_exit, and hand its Window effects to the page.
function io_exit(main, show) {
  try {
    if (show !== null) {
      io_out(1, io_bytes(show_val(...show, 0, run_loop(main()), 0) + "\n"));
      process.exit(0);
    }
    $0eff["Window.open"] = { run: function (title, width, height) {
      return __display.open(title, width, height);
    } };
    $0eff["Window.set_title"] = { run: function (window, title) {
      __display.title(window, title);
      return window;
    } };
    $0eff["Window.close"] = { run: function (window) {
      __display.close(window);
      return { $: "Unit" };
    } };
    $0eff["Window.frame"] = { run: function (window, image, k) {
      __display.show(window, image);
      io_park_on(undefined, false, k, function () {
        return { $: "Tuple", fst: window,
          snd: { $: "Tuple", fst: image, snd: __display.events() } };
      }, __display.due());
      return undefined;
    } };
    __host.pending = __display.run(main,
      { push: io_push, wake: io_wake, park: io_park_on, errs: io_errs, loop: run_loop });
  } catch (e) {
    if (e && e.$ === "$EXIT") {
      throw e;
    }
    io_errs(String(e));
    process.exit(1);
  }
}
