const supportedInputTypes = new Set([
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function editableControl(target) {
  if (target instanceof HTMLTextAreaElement) return target;

  if (
    target instanceof HTMLInputElement &&
    supportedInputTypes.has(target.type)
  ) {
    return target;
  }

  return null;
}

function editableContainer(target) {
  if (!(target instanceof Element)) return null;
  return target.closest('[contenteditable]:not([contenteditable="false"])');
}

function lineStart(value, position) {
  return value.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(value, position) {
  const newline = value.indexOf("\n", position);
  return newline === -1 ? value.length : newline;
}

function moveVertically(value, position, direction) {
  const start = lineStart(value, position);
  const column = position - start;

  if (direction < 0) {
    if (start === 0) return position;
    const previousEnd = start - 1;
    const previousStart = lineStart(value, previousEnd);
    return Math.min(previousStart + column, previousEnd);
  }

  const end = lineEnd(value, position);
  if (end === value.length) return position;
  const nextStart = end + 1;
  return Math.min(nextStart + column, lineEnd(value, nextStart));
}

function moveControl(control, key) {
  const value = control.value;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (start === null || end === null) return false;

  let position;
  switch (key) {
    case "a":
      position = lineStart(value, start);
      break;
    case "b":
      position = start === end ? Math.max(0, start - 1) : start;
      break;
    case "f":
      position = start === end ? Math.min(value.length, end + 1) : end;
      break;
    case "e":
      position = lineEnd(value, end);
      break;
    case "n":
      if (control instanceof HTMLInputElement) return false;
      position = moveVertically(value, end, 1);
      break;
    case "p":
      if (control instanceof HTMLInputElement) return false;
      position = moveVertically(value, start, -1);
      break;
    default:
      return false;
  }

  control.setSelectionRange(position, position);
  return true;
}

function killControlLine(control) {
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (start === null || end === null) return false;

  const killEnd = lineEnd(control.value, end);
  if (start === killEnd) return false;

  control.setRangeText("", start, killEnd, "end");
  control.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentForward",
    }),
  );
  return true;
}

function moveContentEditable(key) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const moves = {
    a: ["backward", "lineboundary"],
    b: ["backward", "character"],
    e: ["forward", "lineboundary"],
    f: ["forward", "character"],
    n: ["forward", "line"],
    p: ["backward", "line"],
  };
  const move = moves[key];
  if (!move) return false;

  selection.modify("move", move[0], move[1]);
  return true;
}

function killContentEditableLine() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  selection.modify("extend", "forward", "lineboundary");
  if (selection.isCollapsed) return false;

  return document.execCommand("delete");
}

document.addEventListener(
  "keydown",
  (event) => {
    if (
      !event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (!["a", "b", "e", "f", "k", "n", "p"].includes(key)) return;

    const target = event.composedPath()[0];
    const control = editableControl(target);
    const moved = control
      ? key === "k"
        ? killControlLine(control)
        : moveControl(control, key)
      : editableContainer(target)
        ? key === "k"
          ? killContentEditableLine()
          : moveContentEditable(key)
        : false;

    if (!moved) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
