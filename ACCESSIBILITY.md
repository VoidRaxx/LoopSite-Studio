# Accessibility Statement

LoopSite Studio aims to make local web development accessible to as many people as possible, including people who use keyboards, assistive technologies, or alternative visual settings.

**Project status:** LoopSite Studio is in active alpha development. This statement describes the current implementation and its limitations; it is **not a certification of accessibility compliance**.

## Our approach

We use the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA as a **design and testing goal**, not as a claim that the application currently meets that standard. We aim to improve keyboard access, readable text, visible focus, assistive-technology compatibility, and predictable interactions as the project develops.

## Existing accessibility features

The current codebase includes:

- **Keyboard interaction:** Standard application controls use native buttons and form inputs. The Monaco-based code editor provides keyboard editing and shortcuts, including save with `Ctrl+S`. The file-tree divider can be resized using the left and right arrow keys when focused.
- **Accessible control information:** Several dialogs, editor tabs, form groups, and buttons have semantic roles, accessible names, or state information (for example, `aria-label`, `aria-selected`, and `aria-pressed`).
- **Appearance preferences:** Theme selection includes system dark/light appearance and multiple alternative palettes. UI sizing can be set to **Compact**, **Normal**, or **Large**. The application also includes visible keyboard-focus styling.
- **Color checks:** Automated checks verify the presence of shared theme tokens and minimum contrast ratios for selected text/background color combinations. These checks do **not** verify every rendered screen or establish WCAG conformance.
- **Reduced motion:** Some UI transitions respect the operating system's `prefers-reduced-motion` preference.
- **Display language:** English is the default, and additional language preferences are available. Translation coverage remains incomplete.

Not all features listed above have been tested with screen readers or other assistive technologies.

## Intended environments

LoopSite Studio is designed for **Windows and Linux** desktop environments using Tauri and the operating system's webview.

Installer and portable packaging, including different Linux distributions, remain under development and testing. Actual behavior may vary with the operating system, desktop environment, webview implementation, input device, and assistive technology.

We have **not yet verified** specific screen-reader/browser combinations, operating-system accessibility APIs, or support for all forms of keyboard-only and assistive-technology use.

## Known limitations

The following areas need further accessibility review and improvement:

- Some screens and workflows may not be fully usable with a keyboard alone, including complex file, database, and modal interactions.
- Screen-reader announcements, focus management, and keyboard focus order have not been comprehensively audited.
- The code editor, resizable panels, log console, and dense database tables may present challenges for some users.
- UI scaling and theme contrast have not been manually verified across every viewport, text-zoom level, and operating system.
- Many screens still contain English or German text that is not yet routed through the language system; complete interface localization is not available.
- There has not yet been a full manual accessibility audit or a formal WCAG 2.2 AA conformance assessment.

Please do not interpret the existence of an accessibility feature or an automated check as proof that the entire application is accessible.

## Report an accessibility barrier

If you encounter a problem, please [open a GitHub issue](https://github.com/VoidRaxx/LoopSite-Studio/issues/new/choose) and start the title with **`[Accessibility]`**.

Helpful details include:

1. The affected screen or task and what you were trying to accomplish.
2. The LoopSite Studio version, operating system, and installation type.
3. The input method or assistive technology used, if relevant (for example, keyboard navigation, screen reader, magnification, or high-contrast settings).
4. Steps to reproduce the barrier and the behavior you expected.
5. A possible workaround or improvement, if you have one.

Screenshots or short recordings are welcome but **not required**. Do not share private project paths, passwords, database contents, or other sensitive data in public reports. If the report reveals a security vulnerability, follow the [Security Policy](SECURITY.md) instead.

Contributions that improve keyboard usability, semantic labeling, focus handling, contrast, and accessibility documentation are welcome; see [Contributing](CONTRIBUTING.md).

## Maintenance

We review accessibility feedback as project resources allow. There is currently **no guaranteed response or remediation timeframe** and no formal external accessibility certification.

This statement was last updated on **November 19, 2026**.
