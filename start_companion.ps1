# Geden Account Switcher - Local Companion Server
# Runs a lightweight HTTP server on http://localhost:4848/ to read and parse Word (.docx) files from network shares

$port = 4848
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "Geden Companion Server started successfully on http://localhost:$port/" -ForegroundColor Green
    Write-Host "Keep this window open to allow automatic file detection in the Chrome Extension." -ForegroundColor Yellow
} catch {
    Write-Error "Failed to start listener on port $port. Check if port is already in use."
    exit
}

# Function to parse Crew DOCX file
function Get-CrewListFromDocx {
    param ($filePath)
    $tempZip = Join-Path $env:TEMP "temp_crew.zip"
    $tempExtract = Join-Path $env:TEMP "temp_crew_extract"
    if (Test-Path $tempZip) { Remove-Item $tempZip -Force }
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    
    Copy-Item $filePath $tempZip
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    
    $xmlPath = Join-Path $tempExtract "word/document.xml"
    if (Test-Path $xmlPath) {
        $xml = [xml](Get-Content $xmlPath -Raw -Encoding utf8)
        $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
        $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
        
        $rows = $xml.SelectNodes("//w:tr", $ns)
        $crewList = @()
        
        # Skip header row (index 0)
        for ($i = 1; $i -lt $rows.Count; $i++) {
            $cells = $rows[$i].SelectNodes("w:tc", $ns)
            if ($cells.Count -ge 5) {
                # Helper to get text in a cell
                $getVal = {
                    param($cell)
                    $texts = $cell.SelectNodes(".//w:t", $ns)
                    $tVal = ""
                    foreach ($t in $texts) { $tVal += $t.InnerText }
                    return $tVal.Trim()
                }
                
                $rank = &$getVal $cells[0]
                $name = &$getVal $cells[1]
                $email = &$getVal $cells[2]
                $password = &$getVal $cells[3]
                $token = &$getVal $cells[4]
                
                if ($email -ne "" -and $token -ne "") {
                    $crewList += @{
                        rank = $rank
                        name = $name
                        email = $email
                        password = $password
                        token = $token
                    }
                }
            }
        }
        return $crewList
    }
    return $null
}

# Function to parse Vessel Token DOCX file
function Get-VesselTokenFromDocx {
    param ($filePath, $vesselUsername)
    $tempZip = Join-Path $env:TEMP "temp_vessel.zip"
    $tempExtract = Join-Path $env:TEMP "temp_vessel_extract"
    if (Test-Path $tempZip) { Remove-Item $tempZip -Force }
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    
    Copy-Item $filePath $tempZip
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    
    $xmlPath = Join-Path $tempExtract "word/document.xml"
    if (Test-Path $xmlPath) {
        $xml = [xml](Get-Content $xmlPath -Raw -Encoding utf8)
        $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
        $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
        
        $texts = $xml.SelectNodes("//w:t", $ns)
        $fullText = ""
        foreach ($t in $texts) {
            $fullText += $t.InnerText + " "
        }
        
        $token = ""
        if ($fullText -match 'is\s*:\s*([A-Z0-9]{7})') {
            $token = $Matches[1]
        }
        
        return @{
            username = $vesselUsername
            token = $token
        }
    }
    return $null
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response
        
        # CORS Headers
        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 200
            $res.Close()
            continue
        }
        
        if ($req.Url.PathAndQuery.StartsWith("/api/detect")) {
            $targetPath = $req.QueryString["path"]
            $vesselUsername = $req.QueryString["username"]
            if (-not $vesselUsername) {
                $vesselUsername = "ASPRING"
            }
            
            if (-not $targetPath -or -not (Test-Path $targetPath)) {
                $res.StatusCode = 400
                $res.ContentType = "application/json"
                $err = @{ error = "Invalid or inaccessible folder path: $targetPath" } | ConvertTo-Json
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($err)
                $res.ContentLength64 = $buffer.Length
                $res.OutputStream.Write($buffer, 0, $buffer.Length)
                $res.Close()
                continue
            }
            
            # Find files
            # Vessel Token: Starts with "TOKEN" and ends with ".docx"
            $vesselFiles = Get-ChildItem -Path $targetPath -Filter "TOKEN*.docx" | Sort-Object LastWriteTime -Descending
            # Crew Tokens: Starts with "WEEKLY CREW TOKEN" and ends with ".docx"
            $crewFiles = Get-ChildItem -Path $targetPath -Filter "WEEKLY CREW TOKEN*.docx" | Sort-Object LastWriteTime -Descending
            
            $vesselData = $null
            $crewData = $null
            $detectedVesselFile = ""
            $detectedCrewFile = ""
            
            if ($vesselFiles.Count -gt 0) {
                $latestVesselFile = $vesselFiles[0].FullName
                $detectedVesselFile = $vesselFiles[0].Name
                $vesselData = Get-VesselTokenFromDocx $latestVesselFile $vesselUsername
            }
            
            if ($crewFiles.Count -gt 0) {
                $latestCrewFile = $crewFiles[0].FullName
                $detectedCrewFile = $crewFiles[0].Name
                $crewData = Get-CrewListFromDocx $latestCrewFile
            }
            
            $responseObj = @{
                success = $true
                vesselFile = $detectedVesselFile
                crewFile = $detectedCrewFile
                vessel = $vesselData
                crew = $crewData
            }
            
            $json = $responseObj | ConvertTo-Json -Depth 5
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.StatusCode = 200
            $res.ContentType = "application/json"
            $res.ContentLength64 = $buffer.Length
            $res.OutputStream.Write($buffer, 0, $buffer.Length)
            $res.Close()
            
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Served API response. Detected Vessel: $detectedVesselFile, Crew: $detectedCrewFile" -ForegroundColor Cyan
        } else {
            $res.StatusCode = 404
            $res.Close()
        }
    } catch {
        Write-Host "Error serving request: $_" -ForegroundColor Red
        if ($res) {
            $res.StatusCode = 500
            $res.Close()
        }
    }
}
