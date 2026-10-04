param([switch]$ProbeOnly)
$ErrorActionPreference = 'Stop'
$agentRoot = $PSScriptRoot
$pythonPath = Join-Path $agentRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $pythonPath)) { throw 'Install agents/requirements.txt in agents/.venv first.' }
if (!(Test-Path -LiteralPath (Join-Path $agentRoot '.env'))) { throw 'Configure server-only agents/.env first.' }
$logRoot = Join-Path $agentRoot 'data/asi-runtime'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ($ProbeOnly) {
    $previousEnabled = $env:ASI_CHAT_ENABLED
    $env:ASI_CHAT_ENABLED = 'false'
} else {
    # dotenv must explicitly enable private access after the live routing gate.
    $bridge = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--env-file=../.env', '--import', 'tsx', 'src/asi-chat-server.ts') -WorkingDirectory (Join-Path $agentRoot 'spacetime-gateway') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "$stamp-bridge.log") -RedirectStandardError (Join-Path $logRoot "$stamp-bridge-error.log")
    Write-Output "ACP bridge PID: $($bridge.Id)"
}
try {
    $transport = Start-Process -FilePath $pythonPath -ArgumentList @('-u', 'asi_networking_agent.py') -WorkingDirectory $agentRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "$stamp-agent.log") -RedirectStandardError (Join-Path $logRoot "$stamp-agent-error.log")
} finally {
    if ($ProbeOnly) { $env:ASI_CHAT_ENABLED = $previousEnabled }
}
Write-Output "ACP transport PID: $($transport.Id)"
Write-Output 'Check the logs for startup success. Stop only these PIDs when finished. Keep this computer awake for judging.'
