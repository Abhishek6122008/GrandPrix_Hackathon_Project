"""Cut a chroma-keyed sprite sheet into transparent PNGs.

    python tools/slice_sheet.py sheet.png gate-entrance exit-gateway concession-food \
                                          concession-merch seating-block barrier

Chat image generators will not give you clean alpha, so the sheets we ask for come back on
flat magenta. This keys that out and finds each sprite by connected region rather than by
assuming a grid: the generator spaces objects by eye, and a hard-coded 3x2 slice cuts limbs off
whichever one drifted.

Needs Pillow, which is installed in ai-service/.venv for tooling only — nothing at runtime
imports it, and it stays out of requirements.txt.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image

OUT_DIR = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "public" / "sprites"

#: How far a pixel may sit from pure magenta and still count as background. Generators dither
#: and soften edges, so an exact match leaves a magenta halo around every sprite.
TOLERANCE = 60

#: Regions smaller than this are dither speckle, not a sprite.
MIN_AREA = 2000


def is_key(pixel: tuple[int, int, int], key: tuple[int, int, int]) -> bool:
    return all(abs(a - b) <= TOLERANCE for a, b in zip(pixel[:3], key))


def is_fringe(pixel: tuple[int, int, int]) -> bool:
    """
    Half-blended edge pixels, which a flat tolerance cannot catch.

    Where a sprite meets the key colour the generator blends the two, leaving a rim of muddy
    purple that sits too far from pure magenta to key out but is obviously not part of the
    artwork — visible as a violet outline once the sprite is composited on a dark map.

    The test is magenta *dominance* rather than proximity: red and blue both well above green.
    Safe for this sheet specifically, where no sprite contains a genuinely magenta pixel. Check
    that assumption before reusing this on artwork that does.
    """
    r, g, b = pixel[:3]
    return r > g + 40 and b > g + 40


def find_regions(mask: list[list[bool]], width: int, height: int) -> list[tuple[int, int, int, int]]:
    """
    Bounding boxes of connected non-background regions.

    Iterative flood fill on purpose — a 1536x1024 sheet is 1.5M pixels and the recursive
    version blows the stack long before it finds anything.
    """
    seen = [[False] * width for _ in range(height)]
    boxes: list[tuple[int, int, int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            if seen[start_y][start_x] or not mask[start_y][start_x]:
                continue
            stack = [(start_x, start_y)]
            seen[start_y][start_x] = True
            min_x = max_x = start_x
            min_y = max_y = start_y
            area = 0
            while stack:
                x, y = stack.pop()
                area += 1
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and not seen[ny][nx] and mask[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if area >= MIN_AREA:
                boxes.append((min_x, min_y, max_x + 1, max_y + 1))

    # Reading order: top row left-to-right, then the next. Rows are grouped by a generous
    # vertical band so a sprite sitting slightly high does not jump the sort.
    boxes.sort(key=lambda b: (b[1] // (height // 4 or 1), b[0]))
    return boxes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sheet", help="path to the chroma-keyed sheet")
    parser.add_argument("names", nargs="+", help="output names in reading order (left-right, top-bottom)")
    parser.add_argument("--pad", type=int, default=4, help="transparent margin around each sprite")
    args = parser.parse_args()

    image = Image.open(args.sheet).convert("RGBA")
    width, height = image.size
    pixels = image.load()

    # The key colour is whatever the corner is — more reliable than assuming pure #FF00FF,
    # since generators rarely hit the exact value they were asked for.
    key = pixels[0, 0][:3]
    print(f"sheet {width}x{height}, key colour rgb{key}")

    mask = [[not is_key(pixels[x, y], key) for x in range(width)] for y in range(height)]
    boxes = find_regions(mask, width, height)
    print(f"found {len(boxes)} sprite regions, {len(args.names)} names given")

    if len(boxes) != len(args.names):
        print("count mismatch — listing boxes so you can re-run with the right names:", file=sys.stderr)
        for i, box in enumerate(boxes):
            print(f"  {i}: {box}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, (x0, y0, x1, y1) in zip(args.names, boxes):
        sprite = image.crop((x0, y0, x1, y1))
        # Clear the key colour inside the crop too — the bounding box is rectangular, so the
        # corners of any non-rectangular sprite are still background.
        sprite_pixels = sprite.load()
        for y in range(sprite.height):
            for x in range(sprite.width):
                pixel = sprite_pixels[x, y]
                if is_key(pixel, key) or is_fringe(pixel):
                    sprite_pixels[x, y] = (0, 0, 0, 0)

        padded = Image.new("RGBA", (sprite.width + args.pad * 2, sprite.height + args.pad * 2), (0, 0, 0, 0))
        padded.paste(sprite, (args.pad, args.pad))
        out = OUT_DIR / f"{name}.png"
        padded.save(out)
        print(f"  {out.name:24} {padded.width}x{padded.height}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
