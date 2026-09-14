param(
    [ValidateSet('open','grip')][string]$Pose = 'open'
)
Add-Type -AssemblyName System.Drawing
$handOutputDir = Join-Path $PSScriptRoot '../artifacts/hand-photo'
New-Item -ItemType Directory -Path $handOutputDir -Force | Out-Null
$handPhotoName = if ($Pose -eq 'grip') { 'D166F57B-4104-46D3-927D-51B1354FE6B6.jpg' } else { '3CF7145B-2158-41D1-B4C2-16BBCF21D91E.jpg' }
$handInput = [System.Drawing.Image]::FromFile((Join-Path 'C:\Users\SSAFY\Downloads' $handPhotoName))
try {
    $handOrientation = ($handInput.PropertyItems | Where-Object Id -eq 274)
    if ($handOrientation) {
        switch ([BitConverter]::ToUInt16($handOrientation.Value, 0)) {
            3 { $handInput.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
            6 { $handInput.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
            8 { $handInput.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
        }
    }
    $handInput.Save((Join-Path $handOutputDir "original-$Pose-hand.png"), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $handInput.Dispose() }
