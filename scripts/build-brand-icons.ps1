# Genera los assets de marca a partir de public/logo.png
# - logo-mark.png      (recortado, para <img> y favicon)
# - favicon.png        (64x64)
# - icons/icon-192.png, icon-512.png, icon-maskable-512.png
# Uso: powershell -ExecutionPolicy Bypass -File scripts/build-brand-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root "public\logo.png"
$iconsDir = Join-Path $root "public\icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

$src = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap($src)
$src.Dispose()

# ---- 1. Encontrar los límites del contenido (no-blanco / no-transparente) ----
$rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$len = $data.Stride * $bmp.Height
$buf = New-Object byte[] $len
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $len)
$bmp.UnlockBits($data)

$minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $bmp.Height; $y++) {
  $rowOff = $y * $data.Stride
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $i = $rowOff + ($x * 4)
    $b = $buf[$i]; $g = $buf[$i + 1]; $r = $buf[$i + 2]; $a = $buf[$i + 3]
    if ($a -gt 10 -and ($r -lt 240 -or $g -lt 240 -or $b -lt 240)) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

if ($maxX -lt 0) { throw "No se encontró contenido en el logo" }

# Margen de seguridad de 4px
$minX = [Math]::Max(0, $minX - 4)
$minY = [Math]::Max(0, $minY - 4)
$maxX = [Math]::Min($bmp.Width - 1, $maxX + 4)
$maxY = [Math]::Min($bmp.Height - 1, $maxY + 4)
$cropW = $maxX - $minX + 1
$cropH = $maxY - $minY + 1
Write-Output "Contenido: ${cropW}x${cropH} en ($minX,$minY) de $($bmp.Width)x$($bmp.Height)"

$cropRect = New-Object System.Drawing.Rectangle($minX, $minY, $cropW, $cropH)
$cropped = $bmp.Clone($cropRect, $bmp.PixelFormat)
$bmp.Dispose()

# ---- 2. lienzo cuadrado con el contenido centrado (proporción original) ----
function New-SquareIcon {
  param([System.Drawing.Image]$Img, [int]$Size, [double]$Fill, [string]$OutPath)

  $canvas = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Ajustar manteniendo proporción (contain) y centrar
  $box = [Math]::Round($Size * $Fill)
  $ratio = [Math]::Min($box / $Img.Width, $box / $Img.Height)
  $w = [Math]::Round($Img.Width * $ratio)
  $h = [Math]::Round($Img.Height * $ratio)
  $x = [Math]::Round(($Size - $w) / 2)
  $y = [Math]::Round(($Size - $h) / 2)
  $g.DrawImage($Img, $x, $y, $w, $h)
  $g.Dispose()

  $canvas.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
  Write-Output ("  -> " + (Split-Path $OutPath -Leaf) + " (${Size}x${Size})")
}

# ---- 3. Generar ----
Write-Output "Generando assets de marca..."
New-SquareIcon -Img $cropped -Size 699 -Fill 1.0 -OutPath (Join-Path $root "public\logo-mark.png")
New-SquareIcon -Img $cropped -Size 64  -Fill 0.88 -OutPath (Join-Path $root "public\favicon.png")
New-SquareIcon -Img $cropped -Size 192 -Fill 0.92 -OutPath (Join-Path $iconsDir "icon-192.png")
New-SquareIcon -Img $cropped -Size 512 -Fill 0.92 -OutPath (Join-Path $iconsDir "icon-512.png")
New-SquareIcon -Img $cropped -Size 512 -Fill 0.68 -OutPath (Join-Path $iconsDir "icon-maskable-512.png")

$cropped.Dispose()
Write-Output "Listo."
