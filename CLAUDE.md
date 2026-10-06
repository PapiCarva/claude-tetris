# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Tetris en JS vanilla + Canvas. Sin build, sin package.json, sin tests, sin linter. Ejecutar: abrir `index.html` o servidor estático (`python -m http.server 8000`). UI y comentarios en español.

## Arquitectura

Tres archivos: `index.html` (DOM + 3 canvas: `board` 300×600, `next-canvas`, `hold-canvas`), `style.css` (temas vía `data-theme` en `<html>`, variables CSS como `--grid`), `game.js` (toda la lógica, estado global a nivel de módulo).

Puntos clave de `game.js` (requieren leer varias secciones):
- Piezas: índices 1–8 (I,O,T,S,Z,J,L,N). `PIECES`, `COLORS`, `COLORS_LIGHT`, `PIECE_LETTERS` están indexados igual; añadir pieza = tocar los cuatro + lista `swap-list` en `index.html` (botón `data-type`). `randomPiece` usa `PIECES.length - 1`. N = tuerca 3×3 con hueco.
- Cola `queue` de `QUEUE_SIZE`=5 piezas; `spawn()` hace shift/push y dispara `endGame()` si colisiona.
- Bucle `loop` con `requestAnimationFrame`; usa `gameTime` (acumulado, no reloj real) para duraciones de habilidades (`peekUntil`, `slowUntil`). Pausa y menú de habilidades cancelan el frame (`cancelAnimationFrame(animId)`) y lo reanudan reseteando `lastTime`.
- Sistema de energía: `clearLines` suma `ENERGY_PER_LINE`; con `ENERGY_MAX` (100) la tecla E abre el menú (`menuOpen`) con 5 habilidades (`ABILITIES`: peek, swap, slow, undo, hold). Usar una gasta toda la energía (`finishAbility`). Teclado en menú: `handleMenuKey` (dígitos/Esc), distinto del handler de juego.
- Undo: `lockPiece` guarda `undoSnapshot` (tablero, tipo, cola, score…) antes de fijar; `restoreSnapshot` lo restaura.
- Hold: solo disponible tras habilidad (`holdCharges`), tecla C, una vez por pieza (`holdUsedThisPiece`).
- Botones: llamar `.blur()` tras click para que Space (hard drop) no los active.
- `draw()` no pinta la pieza actual si `gameOver`. Tema persistido en `localStorage` (envuelto en try/catch).
- Si cambias `COLS`/`ROWS`/`BLOCK`, ajusta `width`/`height` del canvas `board` en `index.html`.

## Git

Commits estilo Conventional (`feat:`, `fix:`), ramas por feature, PRs a `main`. Workflows de Claude en `.github/workflows/`.
