# ИванОператор (ИИ-оператор)

Личный ассистент рабочего стола для Linux и Windows (в т.ч. через Wine).

Нейросеть получает скриншоты и элементы UI, отвечает JSON-действиями; агент выполняет их шаг за шагом, после каждого шага шлёт лог и новый снимок. ИИ-контролёр (сторож) ловит опасные команды, зацикливание, сбои API и переключает провайдера.

## Возможности
- Клики (DPI / мульти-монитор / set-of-marks), ввод с кириллицей через буфер, хоткеи, скролл, drag, shell, открытие приложений
- Браузер (Playwright), adb/fastboot с подтверждением опасных операций
- Провайдеры: Ollama, Pollinations (без ключа), OpenRouter free, Groq, Gemini, OpenAI-совместимые, локальные модели ≤4B
- GitHub по токену пользователя: репозитории, релизы (разрушительное — с подтверждением)
- Постоянный чат на диске с суммаризацией

## Запуск
```bash
npm install
npm start
```

## Сборка
```bash
npm run dist:linux   # AppImage
npm run dist:win     # NSIS exe (также Wine)
```

Личное использование. Сторонние компоненты — по своим лицензиям.

## Что взято готовым (не писали с нуля)
| Компонент | Источник | Лицензия | Зачем |
|-----------|----------|----------|--------|
| Оболочка GUI | [Electron](https://www.electronjs.org/) 33 | MIT | окно, захват экрана (desktopCapturer), буфер обмена |
| Сборка установщиков | [electron-builder](https://www.electron.build/) | MIT | AppImage + NSIS |
| Браузер агента | [Playwright](https://playwright.dev/) (playwright-core) | Apache-2.0 | клики по DOM без промахов |
| Локальные VL-модели | [llama.cpp](https://github.com/ggerganov/llama.cpp) + GGUF Qwen2.5-VL | MIT | локальный движок ≤3–4B |
| AT-SPI метки Linux | GObject Introspection Atspi | LGPL | set-of-marks без OCR |
| Клики/клавиши Linux | xdotool | MIT-like | мышь и хоткеи |
| Клики Windows | свой helper + User32 (идеи как в Microsoft UFO / UIA-first) | — | Win + Wine |
| Идеи архитектуры | [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop), [Agent-S](https://github.com/simular-ai/Agent-S), [agent-desktop](https://github.com/lahfir/agent-desktop), обсуждения Reddit (AX/UIA first, vision fallback), Хабр | Apache/MIT | refine-click, SoM, сторож, a11y-first |

Типичные ошибки чужих систем, которые учли: промах координат при DPI/мульти-мониторе; зацикливание кликов; ответ модели не-JSON; кириллица через SendKeys; rate-limit бесплатных API; OOM от моделей >4B на общем ПК; пустой a11y у Electron — нужен vision/hotkeys fallback.
