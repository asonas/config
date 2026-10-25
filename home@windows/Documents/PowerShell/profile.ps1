function e {
    $projects = Join-Path $HOME 'Documents/asonas/projects'

    $selected = @(
        ghq list -p

        if (Test-Path -LiteralPath $projects) {
            Get-ChildItem -LiteralPath $projects -Directory |
                Select-Object -ExpandProperty FullName
        }
    ) | peco

    if ($selected) {
        Set-Location -LiteralPath $selected
    }
}
