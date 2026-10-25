-- lazy.nvim用のプラグイン設定
return {
  -- NERDTree: ファイルエクスプローラー
  'preservim/nerdtree',

  -- Telescope: ファジーファインダー
  {
    'nvim-telescope/telescope.nvim',
    dependencies = {
      'nvim-lua/plenary.nvim',
      {
        'nvim-telescope/telescope-fzf-native.nvim',
        build = 'make'
      }
    }
  },

  -- GitSigns: Git差分表示
  {
    'lewis6991/gitsigns.nvim',
    dependencies = { 'nvim-lua/plenary.nvim' },
  }
}
