#!/usr/bin/env pwsh
<#
.SYNOPSIS
    BluePartner Integration Validator - Quick diagnostic for setup issues
.DESCRIPTION
    Validates Node.js, npm, dependencies, .env configuration, and local server health
.EXAMPLE
    .\validate-setup.ps1
.NOTES
    Run this before each integration phase to catch configuration issues early
#>

param(
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"
$WarningPreference = "SilentlyContinue"

# Colors
$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

function Write-Status([string]$Message, [string]$Type = "info") {
    switch ($Type) {
        "pass" { Write-Host "$Green✓ $Message$Reset" }
        "fail" { Write-Host "$Red✗ $Message$Reset" }
        "warn" { Write-Host "$Yellow⚠ $Message$Reset" }
        "info" { Write-Host "$Blue→ $Message$Reset" }
    }
}

function Check-Command([string]$Command, [string]$MinVersion = $null) {
    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Status "$Command not found - install it first" "fail"
        return $false
    }
    
    $version = & $Command --version 2>&1 | Select-Object -First 1
    if ($MinVersion) {
        Write-Status "$Command: $version (required: >= $MinVersion)" "pass"
    } else {
        Write-Status "$Command: $version" "pass"
    }
    return $true
}

function Check-EnvVar([string]$VarName, [bool]$Required = $true) {
    $value = Get-Content ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match "^$VarName=" } | ForEach-Object { $_.Split("=")[1] }
    
    if ([string]::IsNullOrWhiteSpace($value)) {
        if ($Required) {
            Write-Status "$VarName not set in .env (REQUIRED)" "fail"
            return $false
        } else {
            Write-Status "$VarName not set in .env (optional)" "warn"
            return $true
        }
    }
    
    # Mask sensitive values
    if ($VarName -match "SECRET|KEY|TOKEN|PASSWORD") {
        $masked = $value.Substring(0, [Math]::Min(5, $value.Length)) + "****"
    } else {
        $masked = $value
    }
    
    Write-Status "$VarName = $masked" "pass"
    return $true
}

function Check-File([string]$Path, [bool]$Required = $true) {
    if (Test-Path $Path) {
        $size = (Get-Item $Path).Length / 1KB
        Write-Status "$Path exists ($('{0:N1}' -f $size) KB)" "pass"
        return $true
    } else {
        if ($Required) {
            Write-Status "$Path not found (REQUIRED)" "fail"
            return $false
        } else {
            Write-Status "$Path not found (optional)" "warn"
            return $true
        }
    }
}

# Header
Write-Host "`n$Blue╔════════════════════════════════════════════╗$Reset"
Write-Host "$Blue║    BluePartner Integration Validator      ║$Reset"
Write-Host "$Blue╚════════════════════════════════════════════╝$Reset`n"

# Phase 1: Environment
Write-Host "$Blue→ Phase 1: Environment Setup$Reset"
$env_ok = Check-Command "node" "18.0.0"
$env_ok = Check-Command "npm" "8.0.0" -and $env_ok

# Phase 2: .env Configuration
Write-Host "`n$Blue→ Phase 2: Environment Variables (.env)$Reset"
if (Test-Path ".env") {
    Write-Status ".env file found" "pass"
    
    # Check critical vars
    $env_ok = Check-EnvVar "NODE_ENV" $true -and $env_ok
    $env_ok = Check-EnvVar "AZURE_AD_CLIENT_ID" ($null -eq $env:NODE_ENV -or $env:NODE_ENV -ne "test") -and $env_ok
    $env_ok = Check-EnvVar "AZURE_AD_TENANT_ID" ($null -eq $env:NODE_ENV -or $env:NODE_ENV -ne "test") -and $env_ok
    $env_ok = Check-EnvVar "AZURE_SQL_CONNECTION_STRING" $false -and $env_ok
    
} else {
    Write-Status ".env not found - copy from .env.example and configure" "fail"
    $env_ok = $false
}

# Phase 3: Dependencies
Write-Host "`n$Blue→ Phase 3: npm Dependencies$Reset"
if (Test-Path "package-lock.json") {
    Write-Status "package-lock.json exists" "pass"
} else {
    Write-Status "package-lock.json not found - run 'npm install' first" "warn"
}

if (Test-Path "node_modules") {
    $count = (Get-ChildItem node_modules -Directory).Count
    Write-Status "node_modules found ($count packages)" "pass"
} else {
    Write-Status "node_modules not found - run 'npm install' first" "fail"
    $env_ok = $false
}

# Phase 4: Database
Write-Host "`n$Blue→ Phase 4: Database$Reset"
$db_ok = Check-File "data/bluepartner.db" $false

# Phase 5: Source Files
Write-Host "`n$Blue→ Phase 5: Source Files$Reset"
$src_ok = Check-File "src/server.js" $true
$src_ok = Check-File "public/index.html" $true -and $src_ok
$src_ok = Check-File "tests/api.test.js" $false -and $src_ok

# Summary
Write-Host "`n$Blue╔════════════════════════════════════════════╗$Reset"
if ($env_ok -and $src_ok) {
    Write-Host "$Green✓ All critical checks passed!$Reset"
    Write-Host "`n$Green→ Ready to run:$Reset"
    Write-Host "   npm start         # Start dev server"
    Write-Host "   npm test          # Run test suite"
    Write-Host "   npm run seed      # Populate test data"
} else {
    Write-Host "$Red✗ Some critical checks failed - see above$Reset"
    Write-Host "`n$Red→ Next steps:$Reset"
    Write-Host "   1. Copy .env.example to .env"
    Write-Host "   2. Fill in Azure AD credentials"
    Write-Host "   3. Run: npm install && npm run seed"
}
Write-Host "$Blue╚════════════════════════════════════════════╝$Reset`n"

exit ($env_ok -and $src_ok ? 0 : 1)
