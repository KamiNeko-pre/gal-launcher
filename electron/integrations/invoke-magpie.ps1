param(
 [Parameter(Mandatory=$true)][string]$MagpiePath,
 [int]$GameProcessId=0,
 [string]$GamePath="",
 [string]$GameWorkingDirectory="",
 [switch]$RestartForPreset
)
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MagpieBridge {
 public delegate bool EnumWindowsProc(IntPtr h,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback,IntPtr param);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr h,string name);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 public static IntPtr FindLargestVisibleWindow(uint targetPid) {
  IntPtr best=IntPtr.Zero; long bestArea=0;
  EnumWindows((h,l) => {
   uint owner; GetWindowThreadProcessId(h,out owner);
   if(owner!=targetPid || !IsWindowVisible(h) || IsIconic(h)) return true;
   Rect rect; if(!GetWindowRect(h,out rect)) return true;
   long width=Math.Max(0,rect.Right-rect.Left), height=Math.Max(0,rect.Bottom-rect.Top), area=width*height;
   if(area>bestArea) { bestArea=area; best=h; }
   return true;
  },IntPtr.Zero);
  return best;
 }
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 public static void Activate(IntPtr h) {
  uint ignored; uint fore=GetWindowThreadProcessId(GetForegroundWindow(),out ignored), current=GetCurrentThreadId();
  bool attached=fore!=current && AttachThreadInput(current,fore,true);
  try { SetForegroundWindow(h); } finally { if(attached) AttachThreadInput(current,fore,false); }
 }
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int cmd);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}
'@
function Owner([IntPtr]$handle) { [uint32]$ownerId=0; [void][MagpieBridge]::GetWindowThreadProcessId($handle,[ref]$ownerId); return $ownerId }
function ScalingWindow {
 return [MagpieBridge]::FindWindowEx([IntPtr]::Zero,[IntPtr]::Zero,'Window_Magpie_967EB565-6F73-4E94-AE53-00CC42592A22',$null)
}
function GameWindow([int]$processId,[int]$timeoutSeconds=10) {
 $deadline=[DateTime]::UtcNow.AddSeconds($timeoutSeconds)
 do {
  $source=[MagpieBridge]::FindLargestVisibleWindow([uint32]$processId)
  if ($source -ne [IntPtr]::Zero) { return $source }
  Start-Sleep -Milliseconds 150
 } while ([DateTime]::UtcNow -lt $deadline)
 return [IntPtr]::Zero
}
function SendScale([IntPtr]$hotkey,[IntPtr]$source) {
 [void][MagpieBridge]::ShowWindowAsync($source,9)
 $shell=New-Object -ComObject WScript.Shell
 [void]$shell.AppActivate($GameProcessId)
 [MagpieBridge]::Activate($source)
 Start-Sleep -Milliseconds 200
 if ([MagpieBridge]::GetForegroundWindow() -ne $source) { throw '无法激活游戏窗口，请检查游戏和启动器的权限是否一致' }
 # Magpie 0.12.1 ShortcutService: WM_HOTKEY, ShortcutAction.Scale = 0.
 $messageResult=[IntPtr]::Zero
 if ([MagpieBridge]::SendMessageTimeout($hotkey,0x312,[IntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$messageResult) -eq [IntPtr]::Zero) { throw '无法向 Magpie 发送缩放消息，请检查权限是否一致' }
}
function WaitForScalingWindow([int]$magpieProcessId,[IntPtr]$source,[int]$timeoutMilliseconds) {
 $deadline=[DateTime]::UtcNow.AddMilliseconds($timeoutMilliseconds)
 do {
 $output=ScalingWindow
  if ($output -ne [IntPtr]::Zero -and (Owner $output) -eq $magpieProcessId -and [MagpieBridge]::IsWindowVisible($output) -and [MagpieBridge]::GetProp($output,'Magpie.SrcHWND') -eq $source) {
   Start-Sleep -Milliseconds 700
   if ((ScalingWindow) -eq $output -and [MagpieBridge]::IsWindowVisible($output)) { return $output }
  }
  if (![MagpieBridge]::IsWindow($source) -or ![MagpieBridge]::IsWindowVisible($source)) { return [IntPtr]::Zero }
  $nextSource=[MagpieBridge]::FindLargestVisibleWindow([uint32]$GameProcessId)
  if ($nextSource -ne [IntPtr]::Zero -and $nextSource -ne $source) { return [IntPtr]::Zero }
  Start-Sleep -Milliseconds 150
 } while ([DateTime]::UtcNow -lt $deadline)
 return [IntPtr]::Zero
}
try {
 $expected = [IO.Path]::GetFullPath($MagpiePath)
 $running = @(Get-Process -Name Magpie -ErrorAction SilentlyContinue)
 $matching = @($running | Where-Object { $_.Path -and [string]::Equals($_.Path,$expected,[StringComparison]::OrdinalIgnoreCase) })
 if (!$matching.Count -and @($running | Where-Object { !$_.Path }).Count) {
  throw '已有管理员权限的 Magpie 正在运行，启动器无法确认其路径。请先退出该 Magpie，再从 Gal Launcher 启动游戏；无需修改系统兼容性设置'
 }
 if (!$matching.Count -and $running.Count) { throw '另一份 Magpie 正在运行，请退出它或在启动器中选择该 Magpie.exe' }
 if ($RestartForPreset -and $matching.Count) {
  if ((ScalingWindow) -ne [IntPtr]::Zero) { throw 'Magpie 正在缩放其他窗口，无法切换超分方案' }
  $matching | Stop-Process -Force
  $matching | Wait-Process -Timeout 8 -ErrorAction SilentlyContinue
  $matching = @()
 }
 if (!$matching.Count) {
  # Magpie itself does not need elevation for an ordinary game, but users may
  # have enabled RUNASADMIN in Windows compatibility settings. Start it at the
  # launcher's integrity level so UIPI does not block the scaling request. This
  # affects only this child process and does not alter the user's registry.
  $previousCompatibilityLayer=$env:__COMPAT_LAYER
  try {
   $env:__COMPAT_LAYER=if ([string]::IsNullOrWhiteSpace($previousCompatibilityLayer)) { 'RunAsInvoker' } else { "$previousCompatibilityLayer RunAsInvoker" }
   $matching = @(Start-Process -FilePath $expected -ArgumentList '-t' -WorkingDirectory ([IO.Path]::GetDirectoryName($expected)) -WindowStyle Hidden -PassThru)
  } finally {
   $env:__COMPAT_LAYER=$previousCompatibilityLayer
  }
 }
 $magpieProcessId = $matching[0].Id
 $deadline = [DateTime]::UtcNow.AddSeconds(15)
 $hotkey = [IntPtr]::Zero
 do {
  $cursor = [IntPtr]::Zero
  do {
   $cursor = [MagpieBridge]::FindWindowEx([IntPtr](-3),$cursor,'Magpie_Hotkey',$null)
   if ($cursor -ne [IntPtr]::Zero -and (Owner $cursor) -eq $magpieProcessId) { $hotkey=$cursor; break }
  } while ($cursor -ne [IntPtr]::Zero)
  if ($hotkey -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
 } while ([DateTime]::UtcNow -lt $deadline)
 if ($hotkey -eq [IntPtr]::Zero) { throw 'Magpie 未就绪或版本不支持当前联动接口' }
 if ($GamePath) {
  if (!(Test-Path -LiteralPath $GamePath -PathType Leaf)) { throw '游戏启动文件不存在' }
  $gameStartArgs=@{ FilePath=$GamePath; PassThru=$true }
  if ($GameWorkingDirectory) { $gameStartArgs.WorkingDirectory=$GameWorkingDirectory }
  $GameProcessId=(Start-Process @gameStartArgs).Id
 }
 if ($GameProcessId -le 0) { throw '缺少游戏进程或启动文件' }
 # Some games replace a splash/boot window with the real render window. If the
 # first source disappears before Magpie creates its output, refresh the HWND
 # and retry once instead of treating the transient window as the game.
 foreach ($attempt in 0,1) {
  $game=Get-Process -Id $GameProcessId
  $source=GameWindow $GameProcessId
  if ($source -eq [IntPtr]::Zero) { throw '游戏窗口已关闭' }
  if ($GamePath -and $attempt -eq 0) {
   Start-Sleep -Milliseconds 250
   $source=GameWindow $GameProcessId
   if ($source -eq [IntPtr]::Zero) { throw '游戏窗口已关闭' }
  }
  $existing=ScalingWindow
  if ($existing -ne [IntPtr]::Zero) {
   if ((Owner $existing) -eq $magpieProcessId -and [MagpieBridge]::GetProp($existing,'Magpie.SrcHWND') -eq $source) {
    @{scaled=$true;alreadyScaling=$true;processId=$GameProcessId;magpieProcessId=$magpieProcessId}|ConvertTo-Json -Compress; exit
   }
   throw 'Magpie 正在缩放其他窗口，请先结束当前缩放'
  }
  SendScale $hotkey $source
  # A freshly-created game window may accept activation before its render
  # surface is ready.  Do not block on the transient window: give the first
  # request 0.5 s, then retarget the current window and retry after 0.5 s.
  $output=WaitForScalingWindow $magpieProcessId $source $(if($GamePath -and $attempt -eq 0){500}else{25000})
  if ($output -ne [IntPtr]::Zero) {
   @{scaled=$true;processId=$GameProcessId;magpieProcessId=$magpieProcessId;sourceWindow=$source.ToInt64();outputWindow=$output.ToInt64();retried=($attempt -gt 0)}|ConvertTo-Json -Compress; exit
  }
  Start-Sleep -Milliseconds 500
 }
 throw 'Magpie 未能建立游戏缩放画面，请检查捕获方式、缩放预设和显卡支持；游戏仍在运行'
} catch { @{scaled=$false;error=$_.Exception.Message;processId=$GameProcessId}|ConvertTo-Json -Compress; exit 1 }
