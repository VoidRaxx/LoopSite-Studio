"""Check Tauri icon format before compiling the native application."""
from pathlib import Path
import struct

png = Path("src-tauri/icons/icon.png").read_bytes()
assert png[:8] == b"\x89PNG\r\n\x1a\n", "Application icon must be PNG"
assert png[12:16] == b"IHDR", "PNG has no valid IHDR"
width, height = struct.unpack(">II", png[16:24])
assert width >= 64 and height >= 64, "Application icon is too small"
assert png[25] == 6, "Tauri icon.png must use RGBA (PNG color type 6)"
ico = Path("src-tauri/icons/icon.ico").read_bytes()
assert ico[:4] == b"\x00\x00\x01\x00", "Windows icon must be a valid .ico file"
print(f"Icons OK: RGBA PNG {width}x{height}, valid ICO header")
