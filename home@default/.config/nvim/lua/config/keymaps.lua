-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set("n", "<Space><Space>", "<cmd>write<cr>", { desc = "Save File", silent = true })
vim.keymap.set("n", "<Space>t", LazyVim.pick("files"), { desc = "Find Files (Root Dir)" })
