$targets = Invoke-RestMethod http://localhost:9222/json
$target = $targets | Where-Object { $_.type -eq "page" -and $_.title -eq "THROATAZOID" } | Select-Object -First 1
if (-not $target) { throw "Throatazoid page target not found." }

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$script:commandId = 0

function Invoke-Cdp([string]$method, $parameters) {
  $script:commandId += 1
  $id = $script:commandId
  $message = @{
    id = $id
    method = $method
    params = $parameters
  } | ConvertTo-Json -Compress -Depth 12
  $bytes = [Text.Encoding]::UTF8.GetBytes($message)
  $segment = [ArraySegment[byte]]::new($bytes)
  $socket.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).Wait()

  while ($true) {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = New-Object byte[] 65536
      $result = $socket.ReceiveAsync(
        [ArraySegment[byte]]::new($buffer),
        [Threading.CancellationToken]::None
      ).Result
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
    $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    if ($response.id -eq $id) {
      if ($response.error) { throw ($response.error | ConvertTo-Json -Compress) }
      return $response
    }
  }
}

Invoke-Cdp "Page.reload" @{ ignoreCache = $true } | Out-Null
Start-Sleep -Milliseconds 1500
Invoke-Cdp "Runtime.evaluate" @{
  expression = @"
document.querySelector('[data-specimen="hydra"]').click();
document.querySelector('#listenSection').open = false;
document.querySelector('#anatomySection').open = true;
document.querySelector('#articulationSection').open = false;
document.querySelector('.panel').scrollTop = 0;
"@
  awaitPromise = $true
} | Out-Null
Start-Sleep -Milliseconds 250
$anatomy = Invoke-Cdp "Page.captureScreenshot" @{ format = "png"; fromSurface = $true }
[IO.File]::WriteAllBytes(
  "\\wsl.localhost\Ubuntu\home\kgalvin\aimprov\morphazoid\.throatazoid-hydra.png",
  [Convert]::FromBase64String($anatomy.result.data)
)

Invoke-Cdp "Runtime.evaluate" @{
  expression = @"
document.querySelector('#anatomySection').open = false;
document.querySelector('#articulationSection').open = true;
document.querySelector('#articulationSection').scrollIntoView({block: 'start'});
"@
  awaitPromise = $true
} | Out-Null
Start-Sleep -Milliseconds 250
$articulation = Invoke-Cdp "Page.captureScreenshot" @{ format = "png"; fromSurface = $true }
[IO.File]::WriteAllBytes(
  "\\wsl.localhost\Ubuntu\home\kgalvin\aimprov\morphazoid\.throatazoid-articulation.png",
  [Convert]::FromBase64String($articulation.result.data)
)

$socket.Dispose()
