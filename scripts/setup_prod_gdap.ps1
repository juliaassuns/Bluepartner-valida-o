<#
PowerShell script to prepare App Registration + App Service for production
Usage: edit variables below then run in an authenticated az session (PowerShell)
Requires: Azure CLI, PowerShell, you must be owner or app owner in Azure AD
#>

param()

# === CONFIGURE THESE ===
$resourceGroup = 'rg-bluepartner'
$appServiceName = 'bluepartner-validacao'
$appId = $env:APP_REGISTRATION_CLIENT_ID
if (-not $appId) {
    Write-Host "App Registration clientId not set via APP_REGISTRATION_CLIENT_ID env var."
    $appId = Read-Host "Enter App Registration clientId (or press Enter to abort)"
    if (-not $appId) {
        Write-Host "No appId provided. Exiting script." -ForegroundColor Yellow
        exit 0
    }
}
$keyVaultName = 'bp-gdap-kv'                     # Key Vault to create/use
$certificatePfxPath = ''                         # Optional: local path to PFX to import
$certificatePassword = ''                        # Optional: password for PFX
$kvSecretName = 'GDAP-Client-Secret'            # Secret name to store client secret (if using secret)

$homePage = 'https://bluepartner.com.br'
$redirectUris = @(
    'https://bluepartner.com.br/auth/callback',
    'https://bluepartner.com.br/',
    'https://www.bluepartner.com.br/'
)

# === Helper / checks ===
Write-Host "Checking Azure CLI login..."
try {
    $acct = az account show --output json | ConvertFrom-Json -ErrorAction Stop
    Write-Host "Logged in as: $($acct.user.name) (subscription: $($acct.name))"
} catch {
    Write-Host "Not logged in. Run 'az login' and re-run this script." -ForegroundColor Red
    exit 1
}

# Get App Registration objectId via Microsoft Graph (safer than legacy az ad app)
Write-Host "Resolving application objectId for appId: $appId"
$appQuery = az rest --method GET --uri "https://graph.microsoft.com/v1.0/applications?
`$filter=appId eq '$appId'" --output json | ConvertFrom-Json
if (-not $appQuery.value -or $appQuery.value.Count -eq 0) {
    Write-Host "Application with appId $appId not found. Check that the appId is correct and that you have privilege." -ForegroundColor Red
    exit 1
}
$appObj = $appQuery.value[0]
$appObjId = $appObj.id
Write-Host "Found application objectId: $appObjId"

# Patch web settings (homePage + redirectUris)
$body = @{ web = @{ homePage = $homePage; redirectUris = $redirectUris } } | ConvertTo-Json -Depth 6
Write-Host "Patching App Registration web settings (homePage + redirectUris)..."
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$appObjId" --body "$body" --headers "Content-Type=application/json"

# Create Key Vault if not exists
Write-Host "Ensure Key Vault exists: $keyVaultName"
$kv = az keyvault show -n $keyVaultName -g $resourceGroup --only-show-errors 2>$null
if (-not $kv) {
    Write-Host "Creating Key Vault $keyVaultName in resource group $resourceGroup"
    az keyvault create -n $keyVaultName -g $resourceGroup --sku standard | Out-Null
} else {
    Write-Host "Key Vault already exists."
}

# If a PFX path is supplied, import it into Key Vault as a certificate
if ($certificatePfxPath -and (Test-Path $certificatePfxPath)) {
    Write-Host "Importing certificate to Key Vault from $certificatePfxPath"
    if ($certificatePassword) {
        az keyvault certificate import --vault-name $keyVaultName -n gdap-cert --file $certificatePfxPath --password $certificatePassword | Out-Null
    } else {
        az keyvault certificate import --vault-name $keyVaultName -n gdap-cert --file $certificatePfxPath | Out-Null
    }
    Write-Host "Imported as certificate name 'gdap-cert'"
} else {
    Write-Host "No PFX provided — skipping certificate import. You can create or import one later in the Key Vault." -ForegroundColor Yellow
}

# Assign system-assigned Managed Identity to App Service
Write-Host "Assigning system-assigned identity to App Service $appServiceName"
az webapp identity assign -g $resourceGroup -n $appServiceName | Out-Null

# Get principalId of the web app managed identity
$principalId = az webapp show -g $resourceGroup -n $appServiceName --query identity.principalId -o tsv
if (-not $principalId) { Write-Host "Failed to get principalId of App Service identity" -ForegroundColor Red; exit 1 }
Write-Host "App Service principalId: $principalId"

# Grant Key Vault access policy for secrets and certificates
Write-Host "Granting Key Vault access policy to App Service identity"
az keyvault set-policy -n $keyVaultName --object-id $principalId --secret-permissions get list --certificate-permissions get list --key-permissions get list | Out-Null

# OPTIONAL: store client secret in Key Vault and set App Setting to reference it
Write-Host "If you are still using a client secret (not certificate), create a secret in Key Vault and update App Setting to reference it."
$useSecret = Read-Host "Do you want to upload an existing GDAP client secret to Key Vault and configure App Setting? (y/N)"
if ($useSecret -match '^[yY]') {
    $existingSecret = Read-Host "Paste the GDAP client secret to store in Key Vault"
    $secretUri = az keyvault secret set --vault-name $keyVaultName -n $kvSecretName --value "$existingSecret" --query id -o tsv
    Write-Host "Secret stored at: $secretUri"

    # Set App Setting to reference Key Vault secret using Managed Identity reference
    # Note: App Service feature 'Managed Identity and Key Vault references' requires enabling system-assigned identity (done above)
    Write-Host "Setting App Setting GDAP_CLIENT_SECRET to use Key Vault reference"
    az webapp config appsettings set -g $resourceGroup -n $appServiceName --settings "GDAP_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=$secretUri)" | Out-Null
    Write-Host "App Setting updated."
}

Write-Host "
NEXT STEPS (manual or deliberate):
- Upload certificate to App Registration (Portal: App registrations → Certificates & secrets → Upload certificate) OR use Graph to add keyCredentials.
- Remove plain-text client secret from App Registration after switching to certificate or Key Vault reference.
- Ask Global Admin to add Application permission 'TenantRelationships.ReadWrite.All' in App Registration and grant admin consent.
- Optionally enable App Service 'Key Vault references' feature and verify access.
- Test the /api/gdap/pool/auto-trigger endpoint after admin consent is granted.
"

Write-Host "Done. Review output for errors and follow NEXT STEPS."