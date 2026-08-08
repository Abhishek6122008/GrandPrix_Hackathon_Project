"""Generate a venue scene with OpenAI's image API and drop it in frontend/public/sprites.

    set OPENAI_API_KEY=sk-...              (PowerShell: $env:OPENAI_API_KEY="sk-...")
    python tools/genimage.py mall "top-down pixel art shopping mall, ..."
    python tools/genimage.py mall --size 1536x1024

Complements PixelLab rather than replacing it. PixelLab generates on a true pixel grid and is
the better tool for sprites and props; general image models render *pixel-art-styled* pictures
with soft edges and off-grid pixels. What they are far better at is a whole composed scene --
the kind of thing PixelLab's per-object endpoints cannot assemble, and which is almost certainly
how the reference board was made.

stdlib only, deliberately: this is an occasional asset script, not part of the app, and it
should not put a dependency into a project that currently needs none to run.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

API_URL = "https://api.openai.com/v1/images/generations"

#: Where the frontend serves static art from, so a generated scene is usable straight away.
OUT_DIR = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "public" / "sprites"

DEFAULT_MODEL = "gpt-image-1"

#: Prepended to whatever you ask for. The reference board's look in one line, so every scene
#: comes out of the same house style instead of drifting per prompt.
STYLE = (
    "16-bit pixel art, top-down game map view, dark navy background, "
    "vivid green-to-red crowd density heatmap overlay, tiny pixel people, "
    "glowing green ENTRANCE and violet EXIT signs, crisp pixel edges, no text labels"
)


def generate(prompt: str, model: str, size: str, key: str) -> bytes:
    """Returns PNG bytes. Raises RuntimeError with the API's own message on failure."""
    request = urllib.request.Request(
        API_URL,
        data=json.dumps({"model": model, "prompt": prompt, "size": size, "n": 1}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        # The API says exactly what is wrong -- a bad model name, no billing, a rejected
        # prompt. Surfacing its text beats a bare 400.
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:600]}") from exc

    item = payload["data"][0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    # Older models answer with a URL rather than inline base64.
    with urllib.request.urlopen(item["url"], timeout=120) as image:
        return image.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", help="output filename stem, e.g. 'mall' -> scene-mall.png")
    parser.add_argument("prompt", nargs="?", default="", help="what to draw; STYLE is prepended")
    parser.add_argument("--size", default="1536x1024")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--raw", action="store_true", help="send the prompt without the house style")
    args = parser.parse_args()

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        print("OPENAI_API_KEY is not set. Get one at https://platform.openai.com/api-keys", file=sys.stderr)
        return 2

    prompt = args.prompt if args.raw else f"{STYLE}. {args.prompt}".strip()
    print(f"model={args.model} size={args.size}\nprompt: {prompt}\n")

    try:
        png = generate(prompt, args.model, args.size, key)
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"scene-{args.name}.png"
    out.write_bytes(png)
    print(f"wrote {out} ({len(png):,} bytes) -> served at /sprites/{out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
