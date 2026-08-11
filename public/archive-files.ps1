<#
.SYNOPSIS
    Arquiva arquivos e diretórios marcados como "ARQUIVAR" no PLANO_DE_LIMPEZA.md.
.DESCRIPTION
    Este script lê o arquivo 'PLANO_DE_LIMPEZA.md', extrai os nomes dos arquivos
    da tabela que estão com o status 'ARQUIVAR' e os move para um
    diretório '_archive', mantendo a estrutura de pastas original.
.EXAMPLE
    .\scripts\archive-files.ps1
    Executa o processo de arquivamento a partir da raiz do projeto.
#>

# Define o diretório raiz do projeto como o local do script
$projectRoot = Split-Path -Path $PSScriptRoot -Parent

# Define o diretório de destino para os arquivos arquivados
$archiveDir = Join-Path -Path $projectRoot -ChildPath "_archive"

# Define o caminho para o plano de limpeza
$planFile = Join-Path -Path $projectRoot -ChildPath "PLANO_DE_LIMPEZA.md"

# Cores para o output
$Green = "`e[32m"
$Yellow = "`e[33m"
$Red = "`e[31m"
$Reset = "`e[0m"

Write-Host "🔵 Iniciando processo de arquivamento..."

# 1. Cria o diretório de arquivamento se não existir
if (-not (Test-Path $archiveDir)) {
    New-Item -Path $archiveDir -ItemType Directory | Out-Null
    Write-Host "$Green- Diretório de destino '$archiveDir' criado.$Reset"
}

# 2. Lê o arquivo de plano e extrai os arquivos a serem arquivados
Write-Host "📄 Lendo '$planFile' para encontrar arquivos marcados como 'ARQUIVAR'..."
$filesToArchive = Get-Content $planFile | Select-String -Pattern '^\s*\|\s*([^|]+?)\s*\|\s*ARQUIVAR\s*\|' | ForEach-Object {
    $_.Matches[0].Groups[1].Value.Trim()
}

if ($filesToArchive.Count -eq 0) {
    Write-Host "$Yellow- Nenhum arquivo marcado como 'ARQUIVAR' foi encontrado.$Reset"
    exit
}

Write-Host "$Green- Encontrados $($filesToArchive.Count) itens para arquivar.$Reset"

# 3. Move cada arquivo/diretório para o diretório de arquivamento
foreach ($file in $filesToArchive) {
    $sourcePath = Join-Path -Path $projectRoot -ChildPath $file
    $destinationPath = Join-Path -Path $archiveDir -ChildPath $file

    if (Test-Path $sourcePath) {
        # Garante que o diretório de destino exista
        $destinationDir = Split-Path -Path $destinationPath -Parent
        if (-not (Test-Path $destinationDir)) {
            New-Item -Path $destinationDir -ItemType Directory -Force | Out-Null
        }
        Move-Item -Path $sourcePath -Destination $destinationPath -Force
        Write-Host "  => Movido: $file"
    } else {
        Write-Host "$Yellow  - Ignorado (não encontrado): $file$Reset"
    }
}

Write-Host "`n$Green✅ Processo de arquivamento concluído!$Reset"
Write-Host "Os arquivos foram movidos para o diretório '_archive'."