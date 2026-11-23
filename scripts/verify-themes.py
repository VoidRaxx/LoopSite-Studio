#!/usr/bin/env python3
"""Check that all LoopSite palettes share accessible design tokens.
No third-party dependencies. This validates the central theme registry, not
screenshot-level rendering, which still requires manual/visual tests.
"""
from pathlib import Path
import re

source = (Path(__file__).resolve().parents[1] / "src" / "themes.ts").read_text(encoding="utf-8")

required = {
    "bg", "panel", "sidebar", "line", "text", "muted",
    "accent", "accentBg", "glass", "danger", "onAccent",
}
pattern = re.compile(
    r'id:\s*"(?P<name>[^"]+)",.*?'
    r'palette:\s*\{(?P<palette>[^}]+)\}',
    re.DOTALL,
)
colors = re.compile(r'(\w+):\s*"([^"]+)"')


def luminance(value: str) -> float:
    channels = [int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    channels = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in channels]
    return sum(weight * channel for weight, channel in zip((0.2126, 0.7152, 0.0722), channels))


def contrast(a: str, b: str) -> float:
    x, y = sorted((luminance(a), luminance(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


palettes = []
for match in pattern.finditer(source):
    name = match.group("name")
    pairs = dict(colors.findall(match.group("palette")))
    omitted = required - pairs.keys()
    assert not omitted, f"{name}: missing tokens: {', '.join(sorted(omitted))}"
    for label, a, b in (
        ("main text/background", "text", "bg"),
        ("main text/panel", "text", "panel"),
        ("muted text/panel", "muted", "panel"),
        ("accent text/button", "onAccent", "accent"),
        ("accent link/panel", "accent", "panel"),
    ):
        value = contrast(pairs[a], pairs[b])
        assert value >= 4.5, f"{name}: {label} contrast {value:.2f} is below 4.5"
    palettes.append(name)

assert set(palettes) == {"light", "dark"}, f"Unexpected palettes: {palettes}"
assert len(set(palettes)) == len(palettes), "Duplicate theme identifiers detected"
assert "system" not in palettes, "System theme must derive from the light/dark palettes"
print(f"Theme checks OK: {len(palettes)} consistent palettes with contrast >= 4.5")
