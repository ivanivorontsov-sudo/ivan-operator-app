# ИванОператор — помощник Windows. Читает JSON-команды построчно из stdin, отвечает одной JSON-строкой.
# Все координаты — физические пиксели (процесс переводится в режим Per-Monitor DPI v2).
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
try { Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes } catch {}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class IOP {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  public static void Dpi() { try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { SetProcessDPIAware(); } }
  static INPUT M(int x, int y, uint flags, int data) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    var i = new INPUT(); i.type = 0;
    i.u.mi.dx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    i.u.mi.dy = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    i.u.mi.dwFlags = flags | 0x8000 | 0x4000; // ABSOLUTE | VIRTUALDESK
    i.u.mi.mouseData = data; return i;
  }
  public static uint Move(int x, int y) { return SendInput(1, new INPUT[]{ M(x,y,0x0001,0) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Btn(int x, int y, uint down, uint up) { return SendInput(2, new INPUT[]{ M(x,y,down,0), M(x,y,up,0) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Down(int x, int y) { return SendInput(1, new INPUT[]{ M(x,y,0x0002,0) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Up(int x, int y) { return SendInput(1, new INPUT[]{ M(x,y,0x0004,0) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Wheel(int x, int y, int amount) { return SendInput(1, new INPUT[]{ M(x,y,0x0800,amount) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Key(ushort vk, bool up) {
    var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk;
    uint f = up ? 2u : 0u;
    if (vk==0x21||vk==0x22||vk==0x23||vk==0x24||vk==0x25||vk==0x26||vk==0x27||vk==0x28||vk==0x2D||vk==0x2E||vk==0x5B) f |= 1; // extended
    i.u.ki.dwFlags = f; return SendInput(1, new INPUT[]{ i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Unicode(string s) {
    foreach (char c in s) {
      var a = new INPUT(); a.type = 1; a.u.ki.wScan = c; a.u.ki.dwFlags = 0x0004;
      var b = new INPUT(); b.type = 1; b.u.ki.wScan = c; b.u.ki.dwFlags = 0x0004 | 0x0002;
      SendInput(2, new INPUT[]{ a, b }, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(4);
    }
  }
  public static string Title() { var h = GetForegroundWindow(); var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@
[IOP]::Dpi()

$VK = @{ ctrl=0x11; control=0x11; alt=0x12; shift=0x10; win=0x5B; super=0x5B; meta=0x5B; enter=0x0D; return=0x0D; esc=0x1B; escape=0x1B; tab=0x09; space=0x20;
  backspace=0x08; delete=0x2E; del=0x2E; insert=0x2D; home=0x24; end=0x23; pageup=0x21; pagedown=0x22; up=0x26; down=0x28; left=0x25; right=0x27; printscreen=0x2C; menu=0x5D }
function KeyCode([string]$k) {
  $l = $k.Trim().ToLower()
  if ($VK.ContainsKey($l)) { return [uint16]$VK[$l] }
  if ($l -match '^f(\d{1,2})$') { return [uint16](0x6F + [int]$Matches[1]) }
  if ($l.Length -eq 1) {
    $c = [char]$l
    if ($c -ge 'a' -and $c -le 'z') { return [uint16]([int][char]$l.ToUpper()) }
    if ($c -ge '0' -and $c -le '9') { return [uint16]([int]$c) }
    $s = [IOP]::VkKeyScan($c); if ($s -ne -1) { return [uint16]($s -band 0xFF) }
  }
  throw "Неизвестная клавиша: $k"
}
function Out($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try {
    $q = $line | ConvertFrom-Json
    switch ($q.cmd) {
      'monitors' {
        $i = 0; $list = @()
        foreach ($s in [System.Windows.Forms.Screen]::AllScreens) { $b = $s.Bounds; $list += @{ index=$i; id=$s.DeviceName; primary=$s.Primary; x=$b.X; y=$b.Y; width=$b.Width; height=$b.Height; scale=1 }; $i++ }
        Out @{ ok=$true; monitors=$list }
      }
      'screenshot' {
        $bmp = New-Object System.Drawing.Bitmap ([int]$q.w), ([int]$q.h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen([int]$q.x, [int]$q.y, 0, 0, $bmp.Size)
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
        Out @{ ok=$true; png=[Convert]::ToBase64String($ms.ToArray()) }
      }
      'mouse' {
        $x=[int]$q.x; $y=[int]$q.y
        [IOP]::Move($x,$y) | Out-Null; Start-Sleep -Milliseconds 60
        switch ($q.action) {
          'move' {}
          'click' { [IOP]::Btn($x,$y,0x2,0x4) | Out-Null }
          'double_click' { [IOP]::Btn($x,$y,0x2,0x4) | Out-Null; Start-Sleep -Milliseconds 70; [IOP]::Btn($x,$y,0x2,0x4) | Out-Null }
          'triple_click' { 1..3 | % { [IOP]::Btn($x,$y,0x2,0x4) | Out-Null; Start-Sleep -Milliseconds 70 } }
          'right_click' { [IOP]::Btn($x,$y,0x8,0x10) | Out-Null }
          'middle_click' { [IOP]::Btn($x,$y,0x20,0x40) | Out-Null }
          'scroll' { [IOP]::Wheel($x,$y, -120 * [int]$q.amount) | Out-Null }
          'drag' {
            [IOP]::Down($x,$y) | Out-Null; Start-Sleep -Milliseconds 150
            $x2=[int]$q.x2; $y2=[int]$q.y2
            for ($k=1; $k -le 10; $k++) { [IOP]::Move([int]($x+($x2-$x)*$k/10), [int]($y+($y2-$y)*$k/10)) | Out-Null; Start-Sleep -Milliseconds 25 }
            Start-Sleep -Milliseconds 120; [IOP]::Up($x2,$y2) | Out-Null
          }
        }
        Out @{ ok=$true }
      }
      'type' {
        if ($q.clipboard) { [System.Windows.Forms.Clipboard]::SetText([string]$q.text); [IOP]::Key(0x11,$false)|Out-Null; [IOP]::Key(0x56,$false)|Out-Null; [IOP]::Key(0x56,$true)|Out-Null; [IOP]::Key(0x11,$true)|Out-Null }
        else {
          $parts = ([string]$q.text) -split "`n"
          for ($i=0; $i -lt $parts.Count; $i++) { [IOP]::Unicode($parts[$i].TrimEnd("`r")); if ($i -lt $parts.Count-1) { [IOP]::Key(0x0D,$false)|Out-Null; [IOP]::Key(0x0D,$true)|Out-Null } }
        }
        Out @{ ok=$true }
      }
      'key' {
        $codes = @(([string]$q.keys) -split '\+' | ? { $_ -ne '' } | % { KeyCode $_ })
        foreach ($c in $codes) { [IOP]::Key($c,$false) | Out-Null; Start-Sleep -Milliseconds 20 }
        [array]::Reverse($codes)
        foreach ($c in $codes) { [IOP]::Key($c,$true) | Out-Null; Start-Sleep -Milliseconds 20 }
        Out @{ ok=$true }
      }
      'cursor' { $p = New-Object IOP+POINT; [IOP]::GetCursorPos([ref]$p) | Out-Null; Out @{ ok=$true; x=$p.X; y=$p.Y } }
      'active' { Out @{ ok=$true; title=[IOP]::Title() } }
      'windows' { Out @{ ok=$true; windows=@(Get-Process | ? { $_.MainWindowTitle } | % { $_.MainWindowTitle }) } }
      'apps' {
        $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
        $names = @(Get-ChildItem -Path $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | % { $_.BaseName } | Sort-Object -Unique)
        Out @{ ok=$true; apps=$names }
      }
      'open' {
        $n = [string]$q.name
        $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
        $lnk = Get-ChildItem -Path $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ? { $_.BaseName -ieq $n } | Select-Object -First 1
        if (-not $lnk) { $lnk = Get-ChildItem -Path $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ? { $_.BaseName -like "*$n*" } | Select-Object -First 1 }
        if ($lnk) { Start-Process $lnk.FullName; Out @{ ok=$true; launched=$lnk.BaseName } }
        else { Start-Process $n; Out @{ ok=$true; launched=$n } }
      }
      'elements' {
        $h = [IOP]::GetForegroundWindow()
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
        $types = [System.Windows.Automation.ControlType]
        $want = @($types::Button,$types::Edit,$types::MenuItem,$types::ListItem,$types::TabItem,$types::Hyperlink,$types::CheckBox,$types::RadioButton,$types::ComboBox,$types::TreeItem,$types::SplitButton,$types::DataItem,$types::Document)
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $res = @(); $n = 0
        foreach ($e in $all) {
          if ($n -ge 150) { break }
          try {
            $c = $e.Current
            if ($c.IsOffscreen -or -not ($want -contains $c.ControlType)) { continue }
            $r = $c.BoundingRectangle
            if ($r.Width -lt 4 -or $r.Height -lt 4 -or [double]::IsInfinity($r.X)) { continue }
            $res += @{ name=$c.Name; role=$c.ControlType.ProgrammaticName.Replace('ControlType.',''); x=[int]$r.X; y=[int]$r.Y; w=[int]$r.Width; h=[int]$r.Height }
            $n++
          } catch {}
        }
        Out @{ ok=$true; elements=$res }
      }
      default { Out @{ ok=$false; error="unknown cmd" } }
    }
  } catch { Out @{ ok=$false; error=$_.Exception.Message } }
}
