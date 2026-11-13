<#
.SYNOPSIS
  Attaches a USB Bluetooth LE adapter to WSL with usbipd-win so Zwifit can use it.

.DESCRIPTION
  Run in Windows PowerShell. The first run for a device must be from an
  administrator prompt (usbipd bind). Later runs, e.g. after each reboot, only attach.
  Safe to run repeatedly.

.PARAMETER BusId
  The adapter's BUSID from `usbipd list` (e.g. 2-3). If omitted, the script lists
  devices and picks the only one whose description mentions Bluetooth.

.PARAMETER Keep
  Keep the device attached: re-attach it whenever it reconnects (usbipd --auto-attach).
  Needed for the ANT+ stick, which drops off the USB bus when it resets. Runs until
  Ctrl+C, so leave that PowerShell window open while you train.

.EXAMPLE
  .\scripts\wsl\attach-bluetooth.ps1 -BusId 2-3
.EXAMPLE
  .\scripts\wsl\attach-bluetooth.ps1 -BusId 2-1 -Keep
#>
param(
	[string]$BusId,
	[switch]$Keep
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
	Write-Error 'usbipd-win is not installed. Install it with: winget install usbipd'
}

$list = usbipd list
if (-not $BusId) {
	$candidates = $list | Where-Object { $_ -match '^\s*(\d+-\d+)\s+\S+\s+.*Bluetooth' }
	if (@($candidates).Count -ne 1) {
		Write-Host $($list -join "`n")
		Write-Error 'Could not pick a single Bluetooth adapter. Re-run with -BusId <BUSID> from the list above.'
	}
	$BusId = ([regex]::Match($candidates, '^\s*(\d+-\d+)')).Groups[1].Value
}

if ($BusId -notmatch '^\d+-\d+$') {
	Write-Error "Invalid BusId '$BusId'. Expected a value like 2-3."
}

$row = $list | Where-Object { $_ -match "^\s*$([regex]::Escape($BusId))\s" }
if (-not $row) {
	Write-Error "No USB device with BUSID $BusId."
}

if ($row -match 'Not shared') {
	Write-Host "Sharing $BusId with WSL (requires administrator)..."
	usbipd bind --busid $BusId
	if ($LASTEXITCODE -ne 0) {
		Write-Error "usbipd bind failed. Run this script once from an administrator PowerShell."
	}
}

if ($Keep) {
	$running = (wsl.exe --list --running --quiet) -replace "`0", '' | Where-Object { $_.Trim() }
	if (-not $running) {
		Write-Error 'No WSL distribution is running. Open an Ubuntu terminal (and keep it open), then run this script again.'
	}
	Write-Host "Keeping $BusId attached to WSL (re-attaches after every reconnect). Leave this window open; Ctrl+C to stop."
	usbipd attach --wsl --busid $BusId --auto-attach
	exit $LASTEXITCODE
}

if ($row -match 'Attached') {
	Write-Host "$BusId is already attached to WSL."
}
else {
	$running = (wsl.exe --list --running --quiet) -replace "`0", '' | Where-Object { $_.Trim() }
	if (-not $running) {
		Write-Error 'No WSL distribution is running. Open an Ubuntu terminal (and keep it open), then run this script again.'
	}
	Write-Host "Attaching $BusId to WSL..."
	usbipd attach --wsl --busid $BusId
	if ($LASTEXITCODE -ne 0) {
		Write-Error "usbipd attach failed (exit code $LASTEXITCODE). See the message above."
	}
}

Write-Host 'Done. In Ubuntu, run: bash scripts/wsl/check-bluetooth.sh'
