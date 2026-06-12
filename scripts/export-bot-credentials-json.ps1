param(
    [string]$InputDir = "credentials/bot_credentials",
    [string]$OutputPath = "credentials/aws-bot-credentials.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputDir -PathType Container)) {
    throw "Input directory not found: $InputDir"
}

$credentials = @()

Get-ChildItem -LiteralPath $InputDir -Filter "*.txt" | Sort-Object Name | ForEach-Object {
    $values = @{}

    Get-Content -LiteralPath $_.FullName | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }

        $parts = $line.Split("=", 2)
        $values[$parts[0].Trim()] = $parts[1].Trim()
    }

    foreach ($requiredKey in @("app_id", "app_secret", "signing_secret")) {
        if ([string]::IsNullOrWhiteSpace($values[$requiredKey])) {
            throw "$($_.Name) is missing required key: $requiredKey"
        }
    }

    $botName = $values["bot_name"]
    if ([string]::IsNullOrWhiteSpace($botName)) {
        $botName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    }

    $credentials += [ordered]@{
        bot_name = $botName
        app_id = $values["app_id"]
        app_secret = $values["app_secret"]
        signing_secret = $values["signing_secret"]
        bot_description = $values["bot_description"]
    }
}

if ($credentials.Count -eq 0) {
    throw "No .txt credential files found in $InputDir"
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$json = $credentials | ConvertTo-Json -Depth 4
$json | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host "Wrote $($credentials.Count) bot credential(s) to $OutputPath"
Write-Host "Paste the file contents as the Secrets Manager plaintext value for soc11/bot-credentials-json."
