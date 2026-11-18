<#
.SYNOPSIS
Keeps this Windows machine awake while the script runs, so the local servers stay up.

.DESCRIPTION
Tells Windows that the system is in use for as long as this window stays open, which stops
it from sleeping or hibernating on its idle timer. The display may still turn off, which
is fine: the API and the web app keep running.

Closing the lid is a separate Windows setting. With -LidClosed the script sets the lid
action to "do nothing" while it runs and puts the previous setting back when it ends.

Press Ctrl+C or close the window to stop. Everything is restored on exit.

.PARAMETER Hours
Stop after this many hours. Without it the script runs until stopped.

.PARAMETER LidClosed
Also keep the machine awake when the lid is closed, while the script runs.

.EXAMPLE
.\scripts\stay-awake.ps1 -Hours 72 -LidClosed
#>
[CmdletBinding()]
param(
    [double]$Hours = 0,
    [switch]$LidClosed
)

$ErrorActionPreference = "Stop"

Add-Type -Namespace StayAwake -Name Power -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
"@

# ES_CONTINUOUS keeps the state until it is cleared; ES_SYSTEM_REQUIRED resets the idle timer.
$ES_CONTINUOUS = [uint32]2147483648  # 0x80000000; PowerShell 5.1 reads the hex form as negative
$ES_SYSTEM_REQUIRED = [uint32]0x00000001

function Get-LidAction([string]$Power) {
    # The current index for the lid action on AC or DC power, as powercfg prints it.
    $query = & powercfg /query SCHEME_CURRENT SUB_BUTTONS LIDACTION 2>$null
    $line = $query | Where-Object { $_ -match "Current $Power Power Setting Index:\s+0x([0-9a-fA-F]+)" }
    if ($null -eq $line) { return $null }
    return [Convert]::ToInt32($Matches[1], 16)
}

$previousLid = $null
try {
    if ($LidClosed) {
        $lid = @{ AC = Get-LidAction "AC"; DC = Get-LidAction "DC" }
        if ($null -eq $lid.AC -and $null -eq $lid.DC) {
            # No lid action in the power plan: nothing to change, and nothing to restore.
            Write-Host "This machine has no lid setting in its power plan, so -LidClosed changes nothing."
        } else {
            $previousLid = $lid
            & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
            & powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
            & powercfg /setactive SCHEME_CURRENT | Out-Null
            Write-Host "Closing the lid will not sleep the machine while this runs."
        }
    }

    $result = [StayAwake.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
    if ($result -eq 0) { throw "Windows refused the request to stay awake." }

    $until = if ($Hours -gt 0) { (Get-Date).AddHours($Hours) } else { $null }
    if ($null -eq $until) {
        Write-Host "Staying awake until this window is closed or Ctrl+C is pressed."
    } else {
        Write-Host ("Staying awake until {0:yyyy-MM-dd HH:mm}. Ctrl+C stops earlier." -f $until)
    }
    Write-Host "Keep the laptop plugged in. Windows Update can still restart it outside your active hours."

    while ($null -eq $until -or (Get-Date) -lt $until) {
        # Re-assert every minute in case anything cleared it.
        [StayAwake.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
        Start-Sleep -Seconds 60
    }
    Write-Host "Time is up. Normal sleep settings apply again."
}
finally {
    [StayAwake.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
    if ($null -ne $previousLid) {
        if ($null -ne $previousLid.AC) {
            & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION $previousLid.AC | Out-Null
        }
        if ($null -ne $previousLid.DC) {
            & powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION $previousLid.DC | Out-Null
        }
        & powercfg /setactive SCHEME_CURRENT | Out-Null
        Write-Host "Lid setting restored."
    }
}
