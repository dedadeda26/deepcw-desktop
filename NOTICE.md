# Attribution & third-party notices

DeepCW Desktop is an unofficial desktop wrapper. It is **not** affiliated with
or endorsed by the original author.

## Decoder engine and models

- **DeepCW engine / models** — © 2026 **e04**
  - <https://github.com/e04/web-deep-cw-decoder> (AGPL-3.0-only)
  - <https://github.com/e04/deepcw-engine> (AGPL-3.0-only)
- The WASM engine in `app/public/engine/` and the model containers in
  `app/public/models/` are redistributed **unmodified**, exactly as served by the
  official web application. They are included so the app can run offline.
- The model containers carry the original `COPYRIGHT@2026 E04` header and are
  **not** covered by this repository's license. They remain the property of the
  author and are included here for personal, non-commercial offline use only.
  If the author asks for their removal, they will be removed from this
  repository.
- All decoding quality comes from that engine and those models; this project
  only adds the desktop shell, UI, radio control and logging.

## Application code

- Everything else in this repository (Electron main process, React UI, CAT
  control, WSJT-X UDP output, i18n, build/signing scripts) is released under the
  **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).
  This is required because the project links the AGPL-3.0 engine.

## Third-party libraries

| Component | License |
| --- | --- |
| Electron | MIT |
| React / React DOM | MIT |
| Mantine | MIT |
| @mantine/hooks | MIT |
| serialport / @serialport | MIT |
| Roboto Mono (font) | SIL Open Font License 1.1 |
| Vite / TypeScript / electron-builder | MIT |

## Data

No user data, credentials or personal information is included in this
repository. Test recordings in `app/public/test/` are synthetic CW generated for
this project.
