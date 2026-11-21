import { View, div } from "gpui-kit";
import { agents, terminals, focused, props, closeOverlay, run } from "herdr";

export default class FocusAttention extends View {
  init() {
    const list = agents();
    const listed = new Set(list.map(a => a.address));
    // A blocked worker puts its parent in Needs you in the shipped agents list.
    const workers = terminals().filter(t => t.state === "live" && t.parent &&
      !listed.has(t.address) && (t.status === "blocked" || t.status === "error"));
    const candidates = list.filter(a => a.status === "blocked")
      .concat(workers)
      .concat(list.filter(a => a.status === "done"));
    const current = focused()?.terminal;
    const index = candidates.findIndex(a => a.address === current);
    const target = candidates[(index + 1) % candidates.length];
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    if (target) run("agent.focus", { terminal: target.address });
  }

  render() {
    return div();
  }
}
