'use strict';
// Опасные команды всегда требуют явного подтверждения Ивана в окне программы (даже при полной автономии).
const RULES = [
  [/\b(fastboot)\s+(?!devices|getvar|--version|help)\S+/i, 'Прошивка/стирание через fastboot: может стереть все данные или окирпичить устройство.'],
  [/\badb\b.*\b(sideload|reboot\s+edl)\b|\badb\b.*\bshell\b.*\b(rm\s+-r|wipe|pm\s+clear|dd\s|recovery\s+--wipe)/i, 'Опасная операция adb: прошивка/стирание данных на устройстве.'],
  [/\bmkfs(\.\w+)?\b|\bwipefs\b|\bsgdisk\b.*-[zZo]|\bparted\b.*\b(mklabel|rm)\b|\bfdisk\b|\bshred\b/i, 'Форматирование/разметка диска — данные будут уничтожены.'],
  [/\bdd\b[^|]*\bof=\/dev\//i, 'Запись напрямую на устройство (dd of=/dev/…) — может уничтожить диск.'],
  [/\brm\s+(-\w*[rf]\w*\s+)+(--no-preserve-root\s+)?(\/|\/(bin|boot|etc|lib|lib64|opt|root|sbin|srv|usr|var|home|sys|proc|dev)(\/\S*)?|~\/?|\$HOME\/?|\*)(\s|$)/i, 'Рекурсивное удаление системных или домашних папок.'],
  [/:\(\)\s*\{.*\};\s*:/, 'Fork-бомба.'],
  [/\b(shutdown|poweroff|halt|reboot|init\s+[06])\b/i, 'Выключение или перезагрузка компьютера.'],
  [/\bchmod\s+(-R\s+)?[0-7]*\s+\/(\s|$)|\bchown\s+-R\s+\S+\s+\/(\s|$)/i, 'Изменение прав на весь корень системы.'],
  [/\bformat(-volume)?\s+[a-z]:|\bformat-volume\b|\bclear-disk\b|\binitialize-disk\b|\bdiskpart\b|\bremove-partition\b/i, 'Форматирование диска Windows.'],
  [/\b(remove-item|rm|del|rd|rmdir)\b.*(-recurse|\/s)\b.*\b[a-z]:\\(windows|users|program files)?\\?\s*$/i, 'Рекурсивное удаление системной папки Windows.'],
  [/\bbcdedit\b|\breg\s+delete\s+hk(lm|ey_local_machine)|\bvssadmin\s+delete\b|\bcipher\s+\/w/i, 'Изменение загрузчика/реестра системы или удаление теневых копий.'],
  [/\b(apt|apt-get|dnf|pacman)\b.*\b(remove|purge|autoremove|-R)\b.*\b(linux-image|systemd|libc6|xorg|gnome-shell|sudo|bash)\b/i, 'Удаление критичных системных пакетов.'],
  [/>\s*\/dev\/(sd|nvme|vd|mmcblk)\w*/i, 'Запись в блочное устройство.'],
];
function check(cmd) {
  const hits = RULES.filter(([re]) => re.test(cmd)).map(([, why]) => why);
  return hits.length ? hits : null;
}
module.exports = { check };
