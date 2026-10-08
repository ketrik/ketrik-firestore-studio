# Change Log

All notable changes to the "Ketrik Firestore Studio" extension will be documented in this file.

## [1.2.0] - 2026-10-08

### Added
- **Root Variables as Virtual Subdocuments**: Open top-level document fields and nested structures independently in dedicated JSON editors.
- **Atomic Partial Updates**: Saving an edited root field uses Firestore's atomic `.update({ [field]: value })` rather than overwriting the entire document.
- **Tree View Document Field Explorer**: Expanding any document now displays all its root variables/fields with type badges (e.g. `{14 keys}`, `[5]`, strings, numbers), alongside subcollections.
- **Field Context Actions**: Open field in editor, copy field path, or delete field directly from the tree view via context menus.

## [1.1.1] - 2026-10-07

### Fixed
- Broadened VS Code engine compatibility (`^1.85.0`) to ensure support across all modern and LTS versions of Visual Studio Code, Cursor, and VSCodium.

## [1.1.0] - 2026-10-05

### Added
- Multi-connection management: Connect to multiple Firestore instances and emulators simultaneously.
- Interactive Collection Table View with live search, pagination, and JSON export.
- Custom modern geometric database icon (`media/logo.png`).
- Type chips and document ID shortcuts in Table View.

### Changed
- Rebranded extension to **Ketrik Firestore Studio**.
- Migrated build system to **esbuild** for sub-100ms bundling and smaller package footprint.
- Modernized TypeScript configuration to `ESNext` and strict type checks.
- Overhauled command palette and context menus for smoother developer workflow.

### Fixed
- Fixed typo in `orderBy` command module and bindings.
- Resolved dependency vulnerabilities and streamlined node dependencies.
