#!/bin/sh
# ИванОператор 1.2.1 — единый установщик (Linux / macOS). Сам выбирает пакет под систему.
set -e
D="$(cd "$(dirname "$0")" && pwd)"; OS="$(uname -s)"; ARCH="$(uname -m)"
echo "ИванОператор: система $OS $ARCH"
case "$OS" in
 Linux)
  if command -v dpkg >/dev/null 2>&1 && ls "$D"/*.deb >/dev/null 2>&1 && [ "$ARCH" = x86_64 ] && command -v sudo >/dev/null; then
    echo "Debian/Ubuntu: ставлю .deb"; sudo apt-get install -y "$D"/ivan-operator_*_amd64.deb || sudo dpkg -i "$D"/ivan-operator_*_amd64.deb
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
