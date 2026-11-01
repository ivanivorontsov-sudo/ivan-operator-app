// ИванОператор: нативный помощник для Windows и Wine (без PowerShell).
// Протокол: одна команда на строку (UTF-8, поля через TAB), ответ — одна строка JSON.
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void out(const char *s) { fputs(s, stdout); fputc('\n', stdout); fflush(stdout); }
static void jstr(char *dst, size_t n, const wchar_t *w) { // UTF-16 → экранированная JSON-строка UTF-8
  char u[2048]; int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, u, sizeof u, NULL, NULL); if (len <= 0) u[0] = 0;
  size_t j = 0; dst[j++] = '"';
  for (char *p = u; *p && j < n - 8; p++) { unsigned char c = *p;
    if (c == '"' || c == '\\') { dst[j++] = '\\'; dst[j++] = c; } else if (c < 32) { j += sprintf(dst + j, "\\u%04x", c); } else dst[j++] = c; }
  dst[j++] = '"'; dst[j] = 0;
}
static wchar_t *wide(const char *s) { int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0); wchar_t *w = malloc(n * 2 + 2); MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n); return w; }

static char mbuf[8192]; static size_t mlen;
static BOOL CALLBACK monProc(HMONITOR h, HDC dc, LPRECT r, LPARAM lp) {
  MONITORINFOEXW mi; mi.cbSize = sizeof mi; GetMonitorInfoW(h, (MONITORINFO *)&mi);
  UINT dpix = 96, dpiy = 96; HMODULE sh = LoadLibraryW(L"shcore.dll");
  if (sh) { typedef HRESULT (WINAPI *F)(HMONITOR, int, UINT *, UINT *); F f = (F)GetProcAddress(sh, "GetDpiForMonitor"); if (f) f(h, 0, &dpix, &dpiy); }
  mlen += snprintf(mbuf + mlen, sizeof mbuf - mlen, "%s{\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld,\"primary\":%s,\"scale\":%.3f}",
    mlen > 30 ? "," : "", mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
    (mi.dwFlags & MONITORINFOF_PRIMARY) ? "true" : "false", dpix / 96.0);
  return TRUE;
}
static void monitors(void) { mlen = snprintf(mbuf, sizeof mbuf, "{\"ok\":true,\"monitors\":["); EnumDisplayMonitors(NULL, NULL, monProc, 0); strcat(mbuf, "]}"); out(mbuf); }

static void shot(int x, int y, int w, int h, const char *path) {
  HDC scr = GetDC(NULL), mem = CreateCompatibleDC(scr);
  BITMAPINFO bi = {0}; bi.bmiHeader.biSize = sizeof bi.bmiHeader; bi.bmiHeader.biWidth = w; bi.bmiHeader.biHeight = -h; bi.bmiHeader.biPlanes = 1; bi.bmiHeader.biBitCount = 32;
  void *bits; HBITMAP bmp = CreateDIBSection(scr, &bi, DIB_RGB_COLORS, &bits, NULL, 0);
  HGDIOBJ old = SelectObject(mem, bmp);
  BOOL ok = BitBlt(mem, 0, 0, w, h, scr, x, y, SRCCOPY | CAPTUREBLT);
  // курсор мыши на снимке
  CURSORINFO ci = { sizeof ci }; if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING)) { ICONINFO ii; if (GetIconInfo(ci.hCursor, &ii)) { DrawIcon(mem, ci.ptScreenPos.x - x - ii.xHotspot, ci.ptScreenPos.y - y - ii.yHotspot, ci.hCursor); if (ii.hbmMask) DeleteObject(ii.hbmMask); if (ii.hbmColor) DeleteObject(ii.hbmColor); } }
  GdiFlush();
  unsigned char *p = bits; for (long i = 0; i < (long)w * h; i++) p[i * 4 + 3] = 255;
  FILE *f = fopen(path, "wb"); if (f) { fwrite(bits, 4, (size_t)w * h, f); fclose(f); }
  SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(NULL, scr);
  char b[200]; snprintf(b, sizeof b, "{\"ok\":%s,\"w\":%d,\"h\":%d,\"error\":\"%s\"}", ok && f ? "true" : "false", w, h, ok ? (f ? "" : "file") : "BitBlt"); out(b);
}

static void btn(DWORD flags, DWORD data) { INPUT in = {0}; in.type = INPUT_MOUSE; in.mi.dwFlags = flags; in.mi.mouseData = data; SendInput(1, &in, sizeof in); }
static void moveTo(int x, int y) { SetCursorPos(x, y); Sleep(30); }
static void mouse(const char *a, int x, int y, int x2, int y2, int amount) {
  moveTo(x, y);
  if (!strcmp(a, "click")) { btn(MOUSEEVENTF_LEFTDOWN, 0); btn(MOUSEEVENTF_LEFTUP, 0); }
  else if (!strcmp(a, "double_click")) { for (int i = 0; i < 2; i++) { btn(MOUSEEVENTF_LEFTDOWN, 0); btn(MOUSEEVENTF_LEFTUP, 0); Sleep(60); } }
  else if (!strcmp(a, "triple_click")) { for (int i = 0; i < 3; i++) { btn(MOUSEEVENTF_LEFTDOWN, 0); btn(MOUSEEVENTF_LEFTUP, 0); Sleep(60); } }
  else if (!strcmp(a, "right_click")) { btn(MOUSEEVENTF_RIGHTDOWN, 0); btn(MOUSEEVENTF_RIGHTUP, 0); }
  else if (!strcmp(a, "middle_click")) { btn(MOUSEEVENTF_MIDDLEDOWN, 0); btn(MOUSEEVENTF_MIDDLEUP, 0); }
  else if (!strcmp(a, "drag")) { btn(MOUSEEVENTF_LEFTDOWN, 0); for (int i = 1; i <= 15; i++) { SetCursorPos(x + (x2 - x) * i / 15, y + (y2 - y) * i / 15); Sleep(20); } btn(MOUSEEVENTF_LEFTUP, 0); }
  else if (!strcmp(a, "scroll")) { btn(MOUSEEVENTF_WHEEL, (DWORD)(-amount * WHEEL_DELTA)); }
  out("{\"ok\":true}");
}

static void typeText(const char *esc) {
  // разэкранирование \n \t \\ ;
  char *s = malloc(strlen(esc) + 1); size_t j = 0;
  for (const char *p = esc; *p; p++) { if (*p == '\\' && p[1]) { p++; s[j++] = *p == 'n' ? '\n' : *p == 't' ? '\t' : *p; } else s[j++] = *p; } s[j] = 0;
  wchar_t *w = wide(s); free(s);
  for (wchar_t *c = w; *c; c++) {
    INPUT in[2] = {0};
    if (*c == L'\n') { in[0].type = in[1].type = INPUT_KEYBOARD; in[0].ki.wVk = in[1].ki.wVk = VK_RETURN; in[1].ki.dwFlags = KEYEVENTF_KEYUP; }
    else { in[0].type = in[1].type = INPUT_KEYBOARD; in[0].ki.wScan = in[1].ki.wScan = *c; in[0].ki.dwFlags = KEYEVENTF_UNICODE; in[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; }
    SendInput(2, in, sizeof(INPUT)); Sleep(8);
  }
  free(w); out("{\"ok\":true}");
}

static WORD vk(const char *k) {
  static const struct { const char *n; WORD v; } T[] = {
    {"ctrl",VK_CONTROL},{"control",VK_CONTROL},{"alt",VK_MENU},{"shift",VK_SHIFT},{"win",VK_LWIN},{"super",VK_LWIN},{"meta",VK_LWIN},{"cmd",VK_LWIN},
    {"enter",VK_RETURN},{"return",VK_RETURN},{"esc",VK_ESCAPE},{"escape",VK_ESCAPE},{"tab",VK_TAB},{"space",VK_SPACE},{"backspace",VK_BACK},
    {"delete",VK_DELETE},{"del",VK_DELETE},{"insert",VK_INSERT},{"home",VK_HOME},{"end",VK_END},{"pageup",VK_PRIOR},{"pagedown",VK_NEXT},
    {"up",VK_UP},{"down",VK_DOWN},{"left",VK_LEFT},{"right",VK_RIGHT},{"printscreen",VK_SNAPSHOT},{"menu",VK_APPS},{"capslock",VK_CAPITAL},
    {"f1",VK_F1},{"f2",VK_F2},{"f3",VK_F3},{"f4",VK_F4},{"f5",VK_F5},{"f6",VK_F6},{"f7",VK_F7},{"f8",VK_F8},{"f9",VK_F9},{"f10",VK_F10},{"f11",VK_F11},{"f12",VK_F12},
    {"plus",VK_OEM_PLUS},{"minus",VK_OEM_MINUS},{NULL,0}};
  for (int i = 0; T[i].n; i++) if (!_stricmp(k, T[i].n)) return T[i].v;
  if (strlen(k) == 1) { char c = k[0]; if (c >= 'a' && c <= 'z') return c - 32; if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; SHORT r = VkKeyScanA(c); if (r != -1) return r & 0xff; }
  return 0;
}
static void keyCombo(char *combo) {
  WORD keys[8]; int n = 0; char *tok = strtok(combo, "+");
  while (tok && n < 8) { while (*tok == ' ') tok++; WORD v = vk(tok); if (!v) { char b[200]; snprintf(b, sizeof b, "{\"ok\":false,\"error\":\"unknown key %s\"}", tok); out(b); return; } keys[n++] = v; tok = strtok(NULL, "+"); }
  INPUT in[16] = {0}; int m = 0;
  for (int i = 0; i < n; i++) { in[m].type = INPUT_KEYBOARD; in[m].ki.wVk = keys[i]; if (keys[i] >= VK_PRIOR && keys[i] <= VK_DELETE) in[m].ki.dwFlags = KEYEVENTF_EXTENDEDKEY; m++; }
  for (int i = n - 1; i >= 0; i--) { in[m].type = INPUT_KEYBOARD; in[m].ki.wVk = keys[i]; in[m].ki.dwFlags = KEYEVENTF_KEYUP | ((keys[i] >= VK_PRIOR && keys[i] <= VK_DELETE) ? KEYEVENTF_EXTENDEDKEY : 0); m++; }
  SendInput(m, in, sizeof(INPUT)); out("{\"ok\":true}");
}

static char wbuf[65536]; static size_t wlen;
static BOOL CALLBACK winProc(HWND h, LPARAM lp) {
  if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER)) return TRUE;
  wchar_t t[512]; if (GetWindowTextW(h, t, 512) <= 0) return TRUE;
  RECT r; GetWindowRect(h, &r); char js[1500]; jstr(js, sizeof js, t);
  if (wlen < sizeof wbuf - 2000) wlen += snprintf(wbuf + wlen, sizeof wbuf - wlen, "%s{\"title\":%s,\"x\":%ld,\"y\":%ld,\"w\":%ld,\"h\":%ld,\"min\":%s}", wlen > 30 ? "," : "", js, r.left, r.top, r.right - r.left, r.bottom - r.top, IsIconic(h) ? "true" : "false");
  return TRUE;
}

int main(void) {
  HMODULE u = GetModuleHandleW(L"user32.dll");
  typedef BOOL (WINAPI *SDAC)(HANDLE); SDAC sdac = (SDAC)GetProcAddress(u, "SetProcessDpiAwarenessContext");
  if (!(sdac && sdac((HANDLE)-4))) SetProcessDPIAware(); // PMv2 → иначе system-aware
  static char line[1 << 20];
  out("{\"ready\":true}");
  while (fgets(line, sizeof line, stdin)) {
    line[strcspn(line, "\r\n")] = 0;
    char *f[8] = {0}; int n = 0; char *p = line; f[n++] = p;
    while ((p = strchr(p, '\t')) && n < 8) { *p++ = 0; f[n++] = p; }
    const char *c = f[0];
    if (!strcmp(c, "monitors")) monitors();
    else if (!strcmp(c, "shot") && n >= 6) shot(atoi(f[1]), atoi(f[2]), atoi(f[3]), atoi(f[4]), f[5]);
    else if (!strcmp(c, "mouse") && n >= 4) mouse(f[1], atoi(f[2]), atoi(f[3]), n > 4 ? atoi(f[4]) : 0, n > 5 ? atoi(f[5]) : 0, n > 6 ? atoi(f[6]) : 0);
    else if (!strcmp(c, "type") && n >= 2) typeText(f[1]);
    else if (!strcmp(c, "key") && n >= 2) keyCombo(f[1]);
    else if (!strcmp(c, "cursor")) { POINT pt; GetCursorPos(&pt); char b[80]; snprintf(b, sizeof b, "{\"ok\":true,\"x\":%ld,\"y\":%ld}", pt.x, pt.y); out(b); }
    else if (!strcmp(c, "active")) { wchar_t t[512] = L""; GetWindowTextW(GetForegroundWindow(), t, 512); char js[1500], b[1600]; jstr(js, sizeof js, t); snprintf(b, sizeof b, "{\"ok\":true,\"title\":%s}", js); out(b); }
    else if (!strcmp(c, "windows")) { wlen = snprintf(wbuf, sizeof wbuf, "{\"ok\":true,\"windows\":["); EnumWindows(winProc, 0); strcat(wbuf, "]}"); out(wbuf); }
    else if (!strcmp(c, "open") && n >= 2) { wchar_t *w = wide(f[1]); wchar_t *a = n > 2 && *f[2] ? wide(f[2]) : NULL; HINSTANCE r = ShellExecuteW(NULL, L"open", w, a, NULL, SW_SHOWNORMAL); char b[100]; snprintf(b, sizeof b, "{\"ok\":%s,\"code\":%lld}", (INT_PTR)r > 32 ? "true" : "false", (long long)(INT_PTR)r); out(b); free(w); free(a); }
    else if (!strcmp(c, "focus") && n >= 2) { wchar_t *w = wide(f[1]); HWND h = FindWindowW(NULL, w); if (h) { if (IsIconic(h)) ShowWindow(h, SW_RESTORE); SetForegroundWindow(h); } out(h ? "{\"ok\":true}" : "{\"ok\":false}"); free(w); }
    else if (!strcmp(c, "ping")) out("{\"ok\":true}");
    else out("{\"ok\":false,\"error\":\"unknown command\"}");
  }
  return 0;
}
