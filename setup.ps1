<#
.SYNOPSIS
Set up dead-claude-skills on this Windows machine: marketplace, plugins, user settings, external tools.

.DESCRIPTION
Adds the dead-claude-skills marketplace, installs dead-skills, asks for each opt-in plugin, adds the
Read(~/.claude/plugins/**) permission and marketplace auto-update to settings.json, and installs
missing external tools where their package manager exists. Safe to re-run. Linux/macOS: setup.sh.

PATs for -Yes runs: GITHUB_PAT, ADO_ORG_URL, ADO_PAT, ADO_API_VERSION, ADO_DEFAULT_PROJECT.

.EXAMPLE
.\setup.ps1

.EXAMPLE
.\setup.ps1 -With graphify,pstack-picks -DryRun
#>
[CmdletBinding()]
param(
    # Install every opt-in plugin.
    [switch]$All,
    # Install mcp-azure and mcp-github.
    [switch]$Work,
    # Install these opt-ins.
    [string[]]$With,
    # No prompts (opt-ins only via -All/-Work/-With).
    [switch]$Yes,
    # Skip the external tool step.
    [switch]$NoTools,
    # Print commands instead of running them.
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$Market = 'dead-claude-skills'
$Repo = 'deadmade/dead-claude-skills'
$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Settings = Join-Path $ConfigDir 'settings.json'
$Perm = 'Read(~/.claude/plugins/**)'
# dead-skills and its dependencies (plugins/dead-skills/.claude-plugin/plugin.json)
$Bundle = @('dead-skills', 'code-review', 'skill-creator', 'claude-code-setup', 'superpowers', 'ponytail',
    'rust-analyzer-lsp', 'csharp-lsp', 'typescript-lsp', 'pyright-lsp', 'nix-lsp', 'mcp-basic')
$OptIns = [ordered]@{
    'mcp-github'       = "GitHub's hosted MCP server (needs a fine-grained PAT)"
    'mcp-azure'        = 'Azure DevOps Server MCP server (needs collection URL + PAT, Node 20+)'
    'mattpocock-picks' = 'curated Matt Pocock skills (grilling, spec to tickets, architecture)'
    'pstack-picks'     = 'curated pstack skills (how/why, review, unslop, architect/arena/swarm)'
    'graphify'         = 'codebase knowledge graph (needs the graphify CLI)'
}

$script:Installed = @()
$script:Missing = @()
$script:Warnings = @()

function Say([string]$Message) { Write-Host $Message }
function Ok([string]$Message) { Write-Host "  ok $Message" -ForegroundColor Green }
function Warn([string]$Message) { Write-Host "  !  $Message" -ForegroundColor Yellow; $script:Warnings += $Message }
function Has([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Runs a native command, or prints it with -DryRun. PAT values are masked when printed.
function Invoke-Step([string]$Exe, [string[]]$Arguments) {
    $shown = $Arguments | ForEach-Object { if ($_ -match '^(\w+_pat)=') { "$($Matches[1])=***" } else { $_ } }
    if ($DryRun) { Say "  > $Exe $($shown -join ' ')"; return $true }
    & $Exe @Arguments | Out-Host
    return ($LASTEXITCODE -eq 0)
}

function Read-YesNo([string]$Question) { (Read-Host "  $Question [y/N]") -match '^[yY]' }

function Read-Secret([string]$Prompt) {
    $secure = Read-Host "  $Prompt" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-JsonList([string[]]$Lines) {
    $parsed = ($Lines | Out-String) | ConvertFrom-Json
    # Windows PowerShell 5.1 returns a top-level array as one object; enumerate it.
    , @($parsed | ForEach-Object { $_ })
}

function Update-Plugins { $script:Plugins = Read-JsonList (& claude plugin list --json) }
function Test-Installed([string]$Name) { [bool]($script:Plugins | Where-Object { $_.id -eq "$Name@$Market" }) }
function Test-Wants([string]$Name) { $Selected[$Name] -or (Test-Installed $Name) }

function Install-Plugin([string]$Name, [string[]]$Config = @()) {
    Say "  -> $Name"
    if (Invoke-Step 'claude' (@('plugin', 'install', "$Name@$Market") + $Config)) { $script:Installed += $Name }
    else { Warn "installing $Name failed" }
}

function Update-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$env:Path"
}

# Installs a missing tool when its package manager exists; otherwise records it as missing.
function Install-Tool([string]$Bin, [string[]]$Command, [string]$Hint) {
    if (Has $Bin) { Ok $Bin; return }
    $manager = $Command[0]
    if (-not (Has $manager)) {
        $script:Missing += $Bin
        Warn "$Bin missing and $manager not found: $Hint"
        return
    }
    Say "  -> $Bin"
    $ok = Invoke-Step $manager @($Command | Select-Object -Skip 1)
    Update-Path
    if (-not $ok) { $script:Missing += $Bin; Warn "installing $Bin failed: $($Command -join ' ')"; return }
    $script:Installed += $Bin
    if (-not $DryRun -and -not (Has $Bin)) { Warn "$Bin installed but not on PATH yet; open a new terminal" }
}

if ($env:OS -ne 'Windows_NT') { throw 'setup.ps1 is for Windows; use ./setup.sh on Linux/macOS.' }
if (-not (Has 'claude')) { throw 'claude not found on PATH; install Claude Code first.' }
if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Keeps 5.1's ConvertTo-Json from wrapping arrays as {"value": [...], "Count": n}.
    Remove-TypeData System.Array -ErrorAction SilentlyContinue
}

$Selected = @{}
if ($All) { foreach ($k in $OptIns.Keys) { $Selected[$k] = $true } }
if ($Work) { $Selected['mcp-azure'] = $true; $Selected['mcp-github'] = $true }
foreach ($o in @($With)) {
    if (-not $o) { continue }
    if (-not $OptIns.Contains($o)) { throw "unknown opt-in: $o (choose from $(@($OptIns.Keys) -join ', '))" }
    $Selected[$o] = $true
}
$picked = $All -or $Work -or [bool]$With
$interactive = -not $Yes -and -not [Console]::IsInputRedirected

# --- opt-ins -------------------------------------------------------------------
Update-Plugins
Say '==> Opt-in plugins'
foreach ($k in $OptIns.Keys) {
    if (Test-Installed $k) { Ok "$k already installed" }
    elseif (-not $picked -and $interactive) {
        if (Read-YesNo "$($k): $($OptIns[$k])?") { $Selected[$k] = $true }
    }
}

# --- marketplace ---------------------------------------------------------------
Say '==> Marketplace'
$markets = Read-JsonList (& claude plugin marketplace list --json)
if ($markets | Where-Object { $_.name -eq $Market }) {
    [void](Invoke-Step 'claude' @('plugin', 'marketplace', 'update', $Market))
}
else {
    [void](Invoke-Step 'claude' @('plugin', 'marketplace', 'add', $Repo))
}

# --- plugins -------------------------------------------------------------------
Say '==> Plugins'
if (Test-Installed 'dead-skills') { Ok 'dead-skills already installed' } else { Install-Plugin 'dead-skills' }

foreach ($o in @('mattpocock-picks', 'pstack-picks', 'graphify')) {
    if ($Selected[$o] -and -not (Test-Installed $o)) { Install-Plugin $o }
}

if ($Selected['mcp-github'] -and -not (Test-Installed 'mcp-github')) {
    $pat = $env:GITHUB_PAT
    if ($DryRun) { $pat = '<pat>' }
    elseif (-not $pat -and $interactive) { $pat = Read-Secret 'GitHub PAT (fine-grained)' }
    if (-not $pat) { Warn 'mcp-github skipped: no PAT (set GITHUB_PAT or run interactively)' }
    else { Install-Plugin 'mcp-github' @('--config', "github_pat=$pat") }
}

if ($Selected['mcp-azure'] -and -not (Test-Installed 'mcp-azure')) {
    $url = $env:ADO_ORG_URL; $pat = $env:ADO_PAT; $ver = $env:ADO_API_VERSION; $proj = $env:ADO_DEFAULT_PROJECT
    if ($DryRun) {
        if (-not $url) { $url = '<url>' }
        $pat = '<pat>'
    }
    elseif ($interactive) {
        if (-not $url) { $url = Read-Host '  Azure DevOps Server collection URL (https://tfs.company/tfs/DefaultCollection)' }
        if (-not $pat) { $pat = Read-Secret 'Azure DevOps PAT' }
        if (-not $ver) { $ver = Read-Host '  REST API version (2022=7.0, 2020=6.0, 2019=5.0) [7.0]' }
        if (-not $proj) { $proj = Read-Host '  Default project (optional)' }
    }
    if (-not $url -or -not $pat) { Warn 'mcp-azure skipped: needs ADO_ORG_URL and ADO_PAT (or run interactively)' }
    else {
        if (-not $ver) { $ver = '7.0' }
        $cfg = @('--config', "ado_org_url=$url", '--config', "ado_pat=$pat", '--config', "ado_api_version=$ver")
        if ($proj) { $cfg += @('--config', "ado_default_project=$proj") }
        Install-Plugin 'mcp-azure' $cfg
    }
}

Update-Plugins
# Copies of the same plugins from claude-plugins-official or ponytail would load twice.
$ours = $Bundle + @($OptIns.Keys)
foreach ($p in ($script:Plugins | Where-Object { $_.enabled })) {
    $name, $from = $p.id -split '@', 2
    if ($from -ne $Market -and $ours -contains $name) {
        Warn "$($p.id) is also enabled and loads twice: claude plugin uninstall $($p.id)"
    }
}

# --- settings.json -------------------------------------------------------------
Say "==> Settings ($Settings)"
function Get-Child($Object, [string]$Name) {
    if (-not ($Object.PSObject.Properties.Name -contains $Name)) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue (New-Object PSObject)
    }
    $Object.$Name
}

$raw = $null
if (Test-Path $Settings) { $raw = [IO.File]::ReadAllText($Settings) }
if ($raw -and (Get-Item $Settings).LinkType) {
    Warn "$Settings is a link (managed elsewhere?); add $Perm and extraKnownMarketplaces.$Market.autoUpdate = true by hand"
}
else {
    if ($raw -and $raw.Trim()) {
        try { $obj = $raw | ConvertFrom-Json } catch { throw "$Settings is not valid JSON: $_" }
    }
    else { $obj = New-Object PSObject }

    $changed = $false
    $perms = Get-Child $obj 'permissions'
    $allow = @($perms.allow | Where-Object { $null -ne $_ })
    if ($allow -notcontains $Perm) {
        $perms | Add-Member -NotePropertyName 'allow' -NotePropertyValue (@($allow) + $Perm) -Force
        $changed = $true
    }
    $entry = Get-Child (Get-Child $obj 'extraKnownMarketplaces') $Market
    if (-not $entry.source) {
        $entry | Add-Member -NotePropertyName 'source' -NotePropertyValue ([pscustomobject]@{ source = 'github'; repo = $Repo }) -Force
        $changed = $true
    }
    if ($entry.autoUpdate -ne $true) {
        $entry | Add-Member -NotePropertyName 'autoUpdate' -NotePropertyValue $true -Force
        $changed = $true
    }

    if (-not $changed) { Ok 'permission and auto-update already set' }
    elseif ($DryRun) { Say "  would add $Perm and autoUpdate = true" }
    else {
        New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
        if ($null -ne $raw) { Copy-Item $Settings "$Settings.bak" -Force }
        $json = $obj | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($Settings, "$json`n", (New-Object Text.UTF8Encoding $false))
        Ok "added $Perm and autoUpdate (backup: $Settings.bak)"
    }
}

# --- external tools ------------------------------------------------------------
if (-not $NoTools) {
    Say '==> External tools'
    $winget = @('--accept-source-agreements', '--accept-package-agreements', '--silent', '-e', '--id')
    # Node is needed for the TypeScript/Pyright servers and mcp-azure's npx.
    Install-Tool 'node' (@('winget', 'install') + $winget + 'OpenJS.NodeJS.LTS') 'winget install OpenJS.NodeJS.LTS'
    Install-Tool 'typescript-language-server' @('npm.cmd', 'i', '-g', 'typescript', 'typescript-language-server') 'install Node.js first'
    Install-Tool 'pyright-langserver' @('npm.cmd', 'i', '-g', 'pyright') 'install Node.js first'
    Install-Tool 'rust-analyzer' @('rustup', 'component', 'add', 'rust-analyzer') 'install Rust via https://rustup.rs'
    Install-Tool 'csharp-ls' @('dotnet', 'tool', 'install', '--global', 'csharp-ls') 'install the .NET SDK 6+ (winget install Microsoft.DotNet.SDK.8)'
    if (-not (Has 'nixd')) { Say '  -- nixd: not available on Windows; silence it with /plugin disable nix-lsp@dead-claude-skills' }
    if (Test-Wants 'graphify') {
        Install-Tool 'uv' (@('winget', 'install') + $winget + 'astral-sh.uv') 'winget install astral-sh.uv'
        Install-Tool 'graphify' @('uv', 'tool', 'install', 'graphifyy') 'install uv first'
        if (-not $DryRun -and -not (Has 'graphify') -and (Has 'uv')) { & uv tool update-shell | Out-Host; Update-Path }
    }
}

if ((Test-Wants 'graphify') -and -not (Has 'graphify') -and -not $DryRun) {
    Warn "graphify's hooks fail on every tool call until the graphify CLI is on PATH"
}

# --- summary -------------------------------------------------------------------
Say '==> Done'
if ($DryRun) { Say '  dry run: nothing was changed' }
if ($script:Installed) { Say "  installed: $($script:Installed -join ', ')" }
if ($script:Missing) { Say "  missing tools: $($script:Missing -join ', ')" }
if ($script:Warnings) {
    Say '  warnings:'
    $script:Warnings | ForEach-Object { Say "    $_" }
}
Say '  Restart Claude Code (or /reload-plugins) to load the changes.'
