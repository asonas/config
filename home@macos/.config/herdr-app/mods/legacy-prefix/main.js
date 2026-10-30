// Preserve the explicitly configured legacy Ctrl+J sequences.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, props, closeOverlay, theme, focused, panes, notify } from "herdr";

export default class LegacyPrefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  render() {
    const t = theme();
    return v_flex().id("legacy-prefix").track_focus(this.handle)
      .size_full().p(18).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          cx.stop_propagation();
          closeOverlay(props().overlay);
          return;
        }
        if (!e.modifiers.control || e.modifiers.alt || e.modifiers.platform || e.modifiers.shift) return;
        const actions = {
          c: ["tab.new", {}], n: ["tab.next", {}], p: ["tab.prev", {}],
          v: ["pane.split", { direction: "right" }],
          s: ["pane.split", { direction: "down" }],
        };
        const action = actions[e.key];
        // Ctrl+I may arrive as Tab on platforms that normalize control keys.
        const cycle = e.key === "i" || e.key === "tab";
        if (!action && !cycle && e.key !== "f") return;
        cx.stop_propagation();
        const current = focused();
        const list = current ? panes().filter(p => p.tab === current.tab) : [];
        closeOverlay(props().overlay);
        if (action) run(action[0], action[1]);
        else if (cycle && list.length) {
          const index = list.findIndex(p => p.pane === current.pane);
          run("pane.focus", { pane: list[(index + 1) % list.length].pane });
        } else if (e.key === "f") {
          notify({ title: "Fingers is not migrated", body: "The legacy herdr-tiny-fingers plugin has no configured Herdr app mod." });
        }
      })
      .child(div().font_semibold().child("Ctrl+J"))
      .child(div().child("Ctrl+C  New tab     Ctrl+N / Ctrl+P  Next / previous tab"))
      .child(div().child("Ctrl+V  Split right     Ctrl+S  Split down"))
      .child(div().child("Ctrl+I  Next pane     Esc  Cancel"))
      .child(div().text_color(t.muted).child("Ctrl+F  Fingers is not migrated"));
  }
}
