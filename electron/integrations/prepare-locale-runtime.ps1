param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
# Official LEInstaller releases this managed dependency from its resources.
# Extract only that runtime; no Explorer registration or system settings change.
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $Directory 'LEInstaller.exe'))
$resources = New-Object System.Resources.ResourceManager('LEInstaller.Properties.Resources', $assembly)
try {
    $bytes = $resources.GetObject('LECommonLibrary')
    if ($bytes -isnot [byte[]] -or $bytes.Length -lt 64) { throw 'Official installer is missing LECommonLibrary' }
    [IO.File]::WriteAllBytes((Join-Path $Directory 'LECommonLibrary.dll'), $bytes)
} finally {
    $resources.ReleaseAllResources()
}
