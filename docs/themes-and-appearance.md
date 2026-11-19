# LoopSite Studio themes & unified UI

## One palette for the entire desktop

Theme definitions live in `src/themes.ts`. Each theme defines the **same eleven tokens** for application background, surface, navigation, borders, main text, muted text, accent, accent background, tinted surface, destructive actions and text on accent. The active palette is applied centrally in `src/App.tsx`.

All major UI components consume these tokens through `src/theme.css`, including:
- sidebar and active navigation;
- project cards and settings panels;
- PHP and server action buttons;
- SQLite and MariaDB tables, controls and forms;
- modal dialogs, confirmation panels and log windows;
- editor tabs and chrome; the Monaco syntax theme switches between dark and light.

To add a palette, extend the `Theme` type and `THEME_OPTIONS` array; no individual component needs palette-specific modifications.

## Available themes (12)

- Systemstandard — uses OS dark/light setting, updates dynamically
- Default — LoopSite navy/cyan, replaces the former `hu` preference
- Universe Dark — violet dark
- Universe Light — lavender light
- Dark — neutral charcoal
- White — neutral light
- Ocean Dark — petrol/turquoise
- Forest Dark — deep green
- Graphite — graphite/gold
- Rose Dark — plum/rosé
- Sunset Light — sand/terracotta
- Arctic Light — ice blue

The LoopSite Studio logo is unchanged. Themes do not change project configuration, databases or servers. The UI intentionally no longer labels its default theme “HybrideUniverse”; old `loopsite-theme=hu` values are interpreted as `default` and rewritten on first use.

## Size

The saved `loopsite-ui-size` preference offers Compact (86%), Normal (100%) and Large (114%). These sizes affect the entire application, including the editor; theme and size preferences are independent.

## Integration validation

`npm run build` checks React/TypeScript validity on Windows and Linux. GitHub Actions also runs native Rust tests, the Windows PHP-router HTTP smoke test and a MariaDB test against a disposable container. The MariaDB TCP readiness probe was updated to wait for a successful authentication on the mapped host port, rather than assuming that successful in-container socket ping means the port is ready.

Installation and visual regression tests on actual Windows/Linux hardware are still needed before treating the theme work as stable.
