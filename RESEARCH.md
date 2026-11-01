# Исследование готовых решений (использовано)

Дата: 2026-10-28. Источники: GitHub, Reddit, UI-TARS issues, сравнения Simular.

## Взято / учтено в коде

1. **Electron + desktopCapturer** — захват экрана без сторонних native (как у UI-TARS Desktop).
2. **Playwright** — браузерные действия по DOM/a11y index (идея UI-TARS MCP browser: `browser_get_clickable_elements` → click by index), а не по пикселям.
3. **AT-SPI (Linux) / UIA-идеи (Windows)** — a11y-first + vision fallback (Reddit r/AI_Agents, r/AgentsOfAI, agent-desktop lahfir, Pupil/UIA discussions).
4. **Set-of-Marks** — из практики Self-Operating Computer / ProjectYolo / Agent-S: номера на элементах.
5. **Сторож + settleMs + retry на rate-limit** — из багов UI-TARS #318 (цикл кликов из‑за раннего скриншота до отрисовки) и #563/#1199 (промах координат у маленьких VL).
6. **Клипборд для кириллицы** — классика Windows SendKeys / xdotool type; не полагаться на ASCII-only type.
7. **llama.cpp** — локальный ≤3–4B, флаги `-c 4096 -np 1 --cache-ram 0` против OOM на общем боксе.
8. **xdotool** вместо robotjs/nut.js — robotjs/nut.js требуют native rebuild под Electron ABI; на Debian 13 + Wine целевой NSIS проще держать CLI-хелперы. nut.js/@nut-tree рассмотрен, отложен (npm платный/build-from-source).

## Не встраивали целиком (тяжёлые / >4B / не наш стек)

- Agent-S / gui-agents (Python, большие модели)
- UI-TARS-1.5-7B и выше (запрет >~4B на общем боксе)
- Cua Spaces (sandbox infra, избыточно)
- Browser-Use как зависимость (взяли Playwright напрямую)

## Типичные ошибки чужих агентов, которые закрываем

| Ошибка | Источник | Наш ответ |
|--------|----------|-----------|
| Повтор одного неверного клика | UI-TARS #318 | watchdog hang/same-action; settleMs; fresh shot |
| Промах DPI / scale | UI-TARS #1199, форумы | sizing.js + normalize + refine |
| Пустой a11y у Electron | Reddit | SoM + hotkeys + vision fallback |
| FREE API 1/30s | Pollinations | Retry-After / 402 FREE_LIMIT |
| OOM локальной VL | практика бокса | ≤3B, cache-ram 0 |
