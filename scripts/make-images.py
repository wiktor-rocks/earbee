"""Generates the app's images from assets/scribee-source.png.

    python3 scripts/make-images.py

  assets/logo.webp     300 px wide: the logo on screen (shown at up to
                       150 px, so sharp on 2x displays); WebP keeps the soft
                       glow at a fraction of the PNG size
  assets/icon-512.png  512x512 window / taskbar icon (Linux, macOS)
  assets/icon.ico      Windows icon, 16-256 px

Re-run after changing the source image. Needs Pillow (python3-pillow).
"""
from pathlib import Path

from PIL import Image

assets = Path(__file__).resolve().parent.parent / "assets"
source = Image.open(assets / "scribee-source.png").convert("RGBA")


def fit_square(image, size):
    """The image centred on a transparent square canvas of `size` px."""
    scaled = image.copy()
    scaled.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return canvas


logo = source.copy()
logo.thumbnail((300, 300), Image.LANCZOS)
logo.save(assets / "logo.webp", quality=92, method=6)

fit_square(source, 512).save(assets / "icon-512.png", optimize=True)
fit_square(source, 256).save(assets / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

for name in ("logo.webp", "icon-512.png", "icon.ico"):
    print(f"{name}: {(assets / name).stat().st_size // 1024} KB")
