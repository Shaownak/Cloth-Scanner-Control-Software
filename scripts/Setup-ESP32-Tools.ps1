$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $taskRoot
$taskPython = Join-Path $taskRoot '.tools\pio-venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 -m venv (Join-Path $taskRoot '.tools\pio-venv') }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { & python -m venv (Join-Path $taskRoot '.tools\pio-venv') }
    else { throw 'Install Python 3.10 or newer, then run this setup again.' }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local firmware tool environment.' }
}
& $taskPython -m pip install platformio==6.1.18
if ($LASTEXITCODE -ne 0) { throw 'Could not install PlatformIO. Check your Internet connection.' }
$env:PLATFORMIO_CORE_DIR = Join-Path $taskRoot '.tools\pio-core'
& $taskPython -m platformio run --project-dir (Join-Path $taskRoot 'esp-code')
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the ESP32 compiler. Review the build output.' }
Write-Host 'ESP32 USB build and upload tools are ready. Open the live dashboard and select Configure ESP32.'
