#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# ИванОператор: доступ к /dev/uinput для ydotool (мышь/клавиатура в Wayland) для пользователя за экраном
RULE=/etc/udev/rules.d/60-ivan-operator-uinput.rules
if [ ! -f "$RULE" ]; then echo 'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess", OPTIONS+="static_node=uinput"' > "$RULE"; fi
modprobe uinput 2>/dev/null || true
grep -qx uinput /etc/modules-load.d/ivan-operator.conf 2>/dev/null || echo uinput > /etc/modules-load.d/ivan-operator.conf
udevadm control --reload-rules 2>/dev/null || true; udevadm trigger --name-match=uinput 2>/dev/null || udevadm trigger 2>/dev/null || true
