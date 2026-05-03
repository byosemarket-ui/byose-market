$root = "c:\Users\kwize\Desktop\byose market4\admin"

Get-ChildItem -Path $root -Recurse -Filter *.html |
  Where-Object { $_.FullName -notlike "*admin-login\admin-login.html" } |
  ForEach-Object {
    $filePath = $_.FullName
    $content = Get-Content -Path $filePath -Raw

    # Remove previous malformed/duplicate security includes
    $content = [regex]::Replace($content, '(?im)^\s*<script\s+src="[^"]*admin-security\.js"[^>]*>\s*</script>\s*\r?\n?', '')
    $content = [regex]::Replace($content, '(?im)^\s*<script\s+src=""[^>]*>\s*</script>\s*\r?\n?', '')

    if ($content -notmatch '(?i)<!DOCTYPE\s+html>') {
      $content = "<!DOCTYPE html>`r`n" + $content.TrimStart()
    }

    if ($content -notmatch '(?i)<html[^>]*>') {
      $content = [regex]::Replace($content, '(?i)(<!DOCTYPE\s+html>)', '$1`r`n<html lang="en">', 1)
    }

    if ($content -notmatch '(?i)<head[^>]*>') {
      $content = [regex]::Replace($content, '(?i)(<html[^>]*>)', '$1`r`n<head>', 1)
    }

    if ($content -notmatch '(?i)</head>') {
      if ($content -match '(?i)<body[^>]*>') {
        $content = [regex]::Replace($content, '(?i)(<body[^>]*>)', '</head>`r`n$1', 1)
      }
      else {
        $content += "`r`n</head>"
      }
    }

    if ($content -notmatch '(?i)<meta\s+charset=') {
      $content = [regex]::Replace($content, '(?i)(<head[^>]*>)', '$1`r`n<meta charset="UTF-8">', 1)
    }

    if ($content -notmatch '(?i)<meta\s+name="viewport"') {
      $content = [regex]::Replace($content, '(?i)(<meta\s+charset=[^>]*>)', '$1`r`n<meta name="viewport" content="width=device-width, initial-scale=1.0">', 1)
    }

    $relativeDir = $_.DirectoryName.Substring($root.Length).TrimStart('\\')
    $depth = 0
    if ($relativeDir) {
      $depth = ($relativeDir -split '\\').Count
    }

    $prefix = ''
    for ($i = 0; $i -lt $depth; $i++) {
      $prefix += '../'
    }

    $securitySrc = $prefix + 'admin-login/js/admin-security.js'
    $securityTag = '<script src="' + $securitySrc + '"></script>'

    $content = [regex]::Replace($content, '(?im)^\s*<script\s+src="[^"]*admin-security\.js"[^>]*>\s*</script>\s*\r?\n?', '')
    $content = [regex]::Replace($content, '(?i)(<meta\s+name="viewport"[^>]*>)', '$1`r`n' + $securityTag, 1)

    if ($content -notmatch '(?i)</html>') {
      $content += "`r`n</html>"
    }

    Set-Content -Path $filePath -Value $content -Encoding UTF8
  }

Write-Output "Admin HTML structure repair complete."
