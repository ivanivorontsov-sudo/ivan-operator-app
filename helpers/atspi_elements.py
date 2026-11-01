#!/usr/bin/env python3
# Список видимых интерактивных элементов активного окна через AT-SPI (Linux). Печатает JSON.
import json, sys
try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except Exception:
    print('[]'); sys.exit(0)
ROLES = {'push button','toggle button','check box','radio button','menu item','menu','page tab','link','entry','text','combo box','list item','table cell','tree item','icon','spin button','slider','password text','toggle','button'}
out = []
def walk(node, depth=0):
    if len(out) >= 150 or depth > 40 or node is None: return
    try:
        role = node.get_role_name()
        st = node.get_state_set()
        if role in ROLES and st.contains(Atspi.StateType.SHOWING) and st.contains(Atspi.StateType.VISIBLE):
            ext = node.get_extents(Atspi.CoordType.SCREEN)
            if ext.width >= 4 and ext.height >= 4 and ext.x > -10000:
                out.append({'name': (node.get_name() or '')[:60], 'role': role, 'x': ext.x, 'y': ext.y, 'w': ext.width, 'h': ext.height})
        for i in range(min(node.get_child_count(), 400)):
            walk(node.get_child_at_index(i), depth + 1)
    except Exception:
        pass
desk = Atspi.get_desktop(0)
for i in range(desk.get_child_count()):
    a = desk.get_child_at_index(i)
    try:
        for j in range(a.get_child_count()):
            w = a.get_child_at_index(j)
            if w.get_state_set().contains(Atspi.StateType.ACTIVE):
                walk(w)
    except Exception:
        pass
print(json.dumps(out, ensure_ascii=False))
