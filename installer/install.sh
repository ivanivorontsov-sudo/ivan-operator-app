#!/bin/sh
# ИванОператор — единый установщик (Linux / macOS). Сам выбирает пакет под систему.
set -e
D="$(cd "$(dirname "$0")" && pwd)"; OS="$(uname -s)"; ARCH="$(uname -m)"
echo "ИванОператор: система $OS $ARCH"
case "$OS" in
 Linux)
  if command -v dpkg >/dev/null 2>&1 && ls "$D"/*.deb >/dev/null 2>&1 && [ "$ARCH" = x86_64 ] && command -v sudo >/dev/null; then
    echo "Debian/Ubuntu: ставлю .deb"; sudo apt-get install -y "$D"/ivan-operator_*_amd64.deb || sudo dpkg -i "$D"/ivan-operator_*_amd64.deb
    WL="ydotool python3-gi gir1.2-glib-2.0 xdg-desktop-portal xdg-desktop-portal-gnome gnome-screenshot wl-clipboard xdotool"
    printf "Поставить поддержку Wayland (снимки экрана через портал, мышь/клавиатура через ydotool): %s ? [Y/n] " "$WL"; read ans || ans=y
    case "$ans" in n|N|н|Н) echo "Пропущено." ;; *)
      sudo apt-get install -y $WL || echo "Часть пакетов не нашлась — не страшно, программа использует то, что есть."
      # /dev/uinput для ydotool и служба ydotoold пользователя
      echo 'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/60-ivan-operator-uinput.rules >/dev/null
      echo uinput | sudo tee /etc/modules-load.d/ivan-operator.conf >/dev/null; sudo modprobe uinput || true
      sudo udevadm control --reload-rules || true; sudo udevadm trigger --name-match=uinput || true
      if command -v ydotoold >/dev/null && command -v systemctl >/dev/null; then
        mkdir -p "$HOME/.config/systemd/user"
        printf '[Unit]\nDescription=ydotoold для ИванОператора\n[Service]\nExecStart=%s --socket-path=%%t/.ydotool_socket --socket-perm=0600\nRestart=on-failure\n[Install]\nWantedBy=default.target\n' "$(command -v ydotoold)" > "$HOME/.config/systemd/user/ivan-ydotoold.service"
        systemctl --user daemon-reload && systemctl --user enable --now ivan-ydotoold.service || echo "Служба ydotoold запустится после перезахода в систему."
      fi
      echo "Wayland готов. Если мышь не двигается — выйдите из системы и войдите снова (применятся права на /dev/uinput)." ;;
    esac
  else
    T="$HOME/.local/bin"; mkdir -p "$T"; cp "$D"/IvanOperator-*.AppImage "$T/IvanOperator.AppImage"; chmod +x "$T/IvanOperator.AppImage"
    mkdir -p "$HOME/.local/share/applications"
    printf '[Desktop Entry]\nName=ИванОператор\nExec=%s\nType=Application\nCategories=Utility;\n' "$T/IvanOperator.AppImage" > "$HOME/.local/share/applications/ivan-operator.desktop"
    echo "AppImage установлен: $T/IvanOperator.AppImage (если не запускается: sudo apt install libfuse2)"
  fi ;;
 Darwin)
  Z="$(ls "$D"/IvanOperator-*-mac*.zip 2>/dev/null | head -1)"
  [ -n "$Z" ] || { echo "Пакет для macOS не найден в архиве"; exit 1; }
  ditto -x -k "$Z" /Applications && xattr -dr com.apple.quarantine "/Applications/ИванОператор.app" 2>/dev/null || true
  echo "Установлено в /Applications (подпись самоподписанная: при первом запуске — ПКМ → Открыть)" ;;
 *) echo "Неизвестная система. Для Windows запустите install.cmd"; exit 1 ;;
esac
