param(
    [string]$ProjectRoot = "",
    [string]$CodexExecutablePath = "",
    [int]$Port = 48731,
    [ValidateSet("off", "notify", "autoWhenIdle")]
    [string]$AutoUpdateMode = "autoWhenIdle",
    [switch]$SkipNpmInstall,
    [switch]$SkipMarketplace,
    [switch]$StartApp
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Invoke-Checked {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
        if ($code -ne 0) {
            throw "$Command $($Arguments -join ' ') failed with exit code $code"
        }
    } finally {
        Pop-Location
    }
}

function Test-CommandAvailable {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cmd) {
        throw "$Name was not found on PATH."
    }
    return $cmd.Source
}

function Test-CodexCandidate {
    param([string]$Candidate)
    try {
        $output = & $Candidate --version 2>&1
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
        return [pscustomobject]@{
            Path = $Candidate
            Ok = ($code -eq 0)
            Message = (($output | Out-String).Trim())
        }
    } catch {
        return [pscustomobject]@{
            Path = $Candidate
            Ok = $false
            Message = $_.Exception.Message
        }
    }
}

function Resolve-CodexExecutable {
    param([string]$RequestedPath)
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($RequestedPath) {
        $candidates.Add($RequestedPath)
    }
    foreach ($cmd in @(Get-Command codex -All -ErrorAction SilentlyContinue)) {
        if ($cmd.Source) { $candidates.Add($cmd.Source) }
    }
    if ($env:LOCALAPPDATA) {
        $localCodex = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\codex.exe"
        if (Test-Path -LiteralPath $localCodex) {
            $candidates.Add($localCodex)
        }
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if (-not $candidate -or $seen.ContainsKey($candidate)) { continue }
        $seen[$candidate] = $true
        $probe = Test-CodexCandidate $candidate
        if ($probe.Ok) {
            Write-Host "Codex executable: $($probe.Path) $($probe.Message)"
            return $probe.Path
        }
        if ($probe.Message -match "Access is denied") {
            Write-Warning "Skipping inaccessible Codex candidate: $($probe.Path) ($($probe.Message))"
        } else {
            Write-Warning "Skipping Codex candidate: $($probe.Path) ($($probe.Message))"
        }
    }
    throw "No runnable Codex executable was found. Pass -CodexExecutablePath with a working codex.exe path."
}

function Save-WorkflowConfig {
    param(
        [string]$Root,
        [string]$CodexPath,
        [int]$AppPort
    )
    $workflowHome = Join-Path $env:USERPROFILE ".codex-workflow"
    $configPath = Join-Path $workflowHome "config.json"
    New-Item -ItemType Directory -Force -Path $workflowHome | Out-Null
    $config = [ordered]@{
        projectRoot = $Root
        codexExecutablePath = $CodexPath
        port = $AppPort
        autoUpdateMode = $AutoUpdateMode
        updateIntervalSec = 300
        updateRemote = "origin"
    }
    $json = $config | ConvertTo-Json -Depth 4
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)
    Write-Host "Config written: $configPath"
}

function Register-Marketplace {
    param(
        [string]$Root,
        [string]$CodexPath
    )
    $marketplacePath = Join-Path $Root ".agents\plugins\marketplace.json"
    if (-not (Test-Path -LiteralPath $marketplacePath)) {
        Write-Warning "Marketplace file not found: $marketplacePath"
        return
    }
    try {
        & $CodexPath plugin marketplace add $Root
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Codex marketplace registration returned exit code $LASTEXITCODE. You can register manually later: codex plugin marketplace add `"$Root`""
        } else {
            Write-Host "Marketplace registration command completed."
        }
    } catch {
        Write-Warning "Marketplace registration failed: $($_.Exception.Message)"
    }
}

function Write-PluginActivationHint {
    $expectedPluginId = "codex-workflow@haram-ai-agent-local"
    $oldPluginId = "codex-workflow@personal"
    $codexConfig = Join-Path $env:USERPROFILE ".codex\config.toml"

    Write-Host ""
    Write-Host "Plugin activation is still a Codex Desktop UI step."
    Write-Host "Expected plugin id: $expectedPluginId"
    Write-Host "Restart Codex Desktop, then install/enable 'Codex Workflow' in the Plugins screen."

    if (Test-Path -LiteralPath $codexConfig) {
        $text = Get-Content -Raw -LiteralPath $codexConfig
        if ($text -match [regex]::Escape($oldPluginId)) {
            Write-Warning "Old plugin id remains in Codex config: $oldPluginId. Disable/remove it and enable $expectedPluginId."
        }
        if ($text -notmatch [regex]::Escape($expectedPluginId)) {
            Write-Warning "$expectedPluginId is not enabled in Codex config yet. This is expected until the Desktop Plugins UI installs/enables it."
        }
    }
}

function Start-WorkflowApp {
    param(
        [string]$Root,
        [string]$CodexPath,
        [int]$AppPort
    )
    try {
        $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$AppPort/api/health" -TimeoutSec 2
        if ($existing.ok) {
            Write-Host "Workflow App is already running on http://127.0.0.1:$AppPort"
            return
        }
    } catch {
        # No running backend on this port. Start below.
    }
    $cli = Join-Path $Root "out\workflow-app\cli.js"
    if (-not (Test-Path -LiteralPath $cli)) {
        throw "Workflow App build not found: $cli"
    }
    $node = Test-CommandAvailable "node"
    $args = @($cli, "--host=127.0.0.1", "--port=$AppPort", "--codex=$CodexPath")
    Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden
    Write-Host "Workflow App starting on http://127.0.0.1:$AppPort"
}

function Test-Health {
    param([int]$AppPort)
    $uri = "http://127.0.0.1:$AppPort/api/health"
    $deadline = (Get-Date).AddSeconds(12)
    do {
        try {
            $health = Invoke-RestMethod -Uri $uri -TimeoutSec 2
            Write-Host "Health OK: port=$($health.port), appServerAvailable=$($health.appServerAvailable), sdkAvailable=$($health.sdkAvailable)"
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    throw "Workflow App health check failed: $uri"
}

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

Write-Step "Checking prerequisites"
Test-CommandAvailable "node" | Out-Null
Test-CommandAvailable "npm" | Out-Null
Test-CommandAvailable "git" | Out-Null
$codexPath = Resolve-CodexExecutable $CodexExecutablePath

Write-Step "Writing local Workflow App config"
Save-WorkflowConfig -Root $ProjectRoot -CodexPath $codexPath -AppPort $Port

if (-not $SkipNpmInstall) {
    Write-Step "Installing npm dependencies"
    Invoke-Checked "npm" @("ci") $ProjectRoot
}

Write-Step "Compiling extension and Workflow App"
Invoke-Checked "npm" @("run", "compile") $ProjectRoot

if (-not $SkipMarketplace) {
    Write-Step "Registering Codex plugin marketplace"
    Register-Marketplace -Root $ProjectRoot -CodexPath $codexPath
}

Write-PluginActivationHint

if ($StartApp) {
    Write-Step "Starting Workflow App"
    Start-WorkflowApp -Root $ProjectRoot -CodexPath $codexPath -AppPort $Port
    Test-Health -AppPort $Port
} else {
    Write-Host "Run with -StartApp to launch the Workflow App after setup."
}

Write-Step "Setup complete"
Write-Host "Workflow App URL: http://127.0.0.1:$Port"
