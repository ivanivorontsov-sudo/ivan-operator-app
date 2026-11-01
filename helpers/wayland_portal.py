#!/usr/bin/env python3
# ИванОператор 1.3.0: снимок экрана в Wayland (GNOME/KDE) через xdg-desktop-portal (org.freedesktop.portal.Screenshot).
# GNOME один раз спросит разрешение; дальше снимки без вопросов. Выводит путь к PNG.
import sys, urllib.parse
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = 'iop%d' % (GLib.get_monotonic_time() % 100000000)
sender = bus.get_unique_name()[1:].replace('.', '_')
handle = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender, token)
loop = GLib.MainLoop(); res = {}
def on_resp(conn, snd, path, iface, sig, params):
    code, results = params.unpack(); res['code'] = code; res['uri'] = results.get('uri', ''); loop.quit()
bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response', handle, None, Gio.DBusSignalFlags.NO_MATCH_RULE, on_resp)
bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Screenshot', 'Screenshot',
              GLib.Variant('(sa{sv})', ('', {'handle_token': GLib.Variant('s', token), 'interactive': GLib.Variant('b', False)})), None, Gio.DBusCallFlags.NONE, 10000, None)
GLib.timeout_add_seconds(int(sys.argv[1]) if len(sys.argv) > 1 else 60, loop.quit)
loop.run()
if res.get('code') == 0 and res.get('uri', '').startswith('file://'):
    print(urllib.parse.unquote(res['uri'][7:])); sys.exit(0)
sys.stderr.write('portal: code=%s\n' % res.get('code')); sys.exit(2)
