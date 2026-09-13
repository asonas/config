-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Toggle Fcitx5/Mozc with the right Command key alone.
-- Modifier-only binds need the target modifier in both the mask and key.
o.bind("SUPER + Super_R", "Toggle Japanese input", "fcitx5-remote -t", { release = true })

local function switch_chromium_tab(mods)
  return function()
    local window = hl.get_active_window()
    if not window then
      return
    end

    local is_chromium = false
    for _, tag in ipairs(window.tags or {}) do
      if tag:gsub("%*$", "") == "chromium-based-browser" then
        is_chromium = true
        break
      end
    end

    if not is_chromium then
      return
    end

    hl.dispatch(hl.dsp.send_key_state({ mods = mods, key = "TAB", state = "down" }))
    hl.timer(function()
      hl.dispatch(hl.dsp.send_key_state({ mods = mods, key = "TAB", state = "up" }))
    end, { timeout = 50, type = "oneshot" })
  end
end

o.bind("SUPER + SHIFT + J", "Previous Chromium tab", switch_chromium_tab("CTRL + SHIFT"))
o.bind("SUPER + SHIFT + K", "Next Chromium tab", switch_chromium_tab("CTRL"))

-- Let Herdr handle Cmd+Shift+N for creating a new workspace.
hl.unbind("SUPER + SHIFT + N")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")
