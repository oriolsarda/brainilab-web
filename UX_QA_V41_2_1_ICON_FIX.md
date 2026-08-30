# BrainiLab V41.2.3 — Icon semantics patch

Implemented:
- World Flags uses a dedicated green outline flag icon.
- World Capitals uses a dedicated green outline globe icon.
- Header streak uses the native 🔥 emoji already present in the HTML instead of `/assets/icons/product/streak.svg`.
- Dynamic Play Anytime surfaces resolve `worldflags` and `worldcapitals` to the same distinct icons.
- Asset cache-busting/build marker bumped to `41.2.3`.

Static verification:
- No World Flags/World Capitals card in `games/index.html` points to the shared `geography.svg`.
- V41.2 streak pseudo-icon is disabled and the emoji text is visible.
