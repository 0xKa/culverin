import argparse
import math
import re
import struct
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

SOURCE = Path("assets/original/culverin-original-stats.svg")
OUTPUT = Path("extension/public/icons")
STYLES = Path("extension/src/ui/styles.css")
SIZES = (16, 32, 48, 128)
GRID = 128 // 16
NAMESPACE = "{http://www.w3.org/2000/svg}"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def color(value):
    if not value or len(value) != 7 or value[0] != "#":
        raise ValueError("Icon fills must be six-digit hexadecimal colors")
    return tuple(bytes.fromhex(value[1:])) + (255,)


def rectangles(source):
    root = ET.parse(source).getroot()
    if root.tag != NAMESPACE + "svg" or root.get("viewBox") != "0 0 128 128":
        raise ValueError("Unexpected icon source format")
    result = []

    def walk(node, inherited):
        fill = node.get("fill", inherited)
        if node.tag == NAMESPACE + "rect":
            x = int(node.get("x", "0"))
            y = int(node.get("y", "0"))
            width = int(node.attrib["width"])
            height = int(node.attrib["height"])
            if any(value % GRID for value in (x, y, width, height)):
                raise ValueError("Icon rectangles must align to the 16 by 16 grid")
            result.append((x, y, x + width, y + height, color(fill)))
        elif node.tag in (NAMESPACE + "svg", NAMESPACE + "g"):
            for child in node:
                walk(child, fill)
        else:
            raise ValueError("Unsupported SVG element in icon source")

    walk(root, None)
    return result


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def decoded(data):
    if not data.startswith(PNG_SIGNATURE):
        return None
    chunks = []
    image = bytearray()
    offset = len(PNG_SIGNATURE)
    try:
        while offset < len(data):
            (length,) = struct.unpack_from(">I", data, offset)
            kind = data[offset + 4 : offset + 8]
            body = data[offset + 8 : offset + 8 + length]
            (crc,) = struct.unpack_from(">I", data, offset + 8 + length)
            if len(body) != length or crc != zlib.crc32(kind + body):
                return None
            if kind == b"IDAT":
                image.extend(body)
                if not chunks or chunks[-1] != (b"IDAT", b""):
                    chunks.append((b"IDAT", b""))
            else:
                chunks.append((kind, body))
            offset += 12 + length
        return chunks, zlib.decompress(bytes(image))
    except (struct.error, zlib.error):
        return None


def png(size, layers):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        source_y = (y + 0.5) * 128 / size
        for x in range(size):
            source_x = (x + 0.5) * 128 / size
            pixel = (0, 0, 0, 0)
            for left, top, right, bottom, fill in layers:
                if left <= source_x < right and top <= source_y < bottom:
                    pixel = fill
            rows.extend(pixel)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def accent_colors(styles):
    css = " ".join(styles.read_text().split())
    token = re.search(
        r"--color-accent: oklch\(([\d.]+) calc\(([\d.]+) \* var\(--accent-c\)\) var\(--accent-h\)\)",
        css,
    )
    if token is None:
        raise ValueError("Missing light accent color")
    lightness, chroma = map(float, token.groups())
    colors = {}
    for name, rule in re.findall(r'\[data-accent="([a-z]+)"\] \{([^}]+)\}', css):
        hue = re.search(r"--accent-h: ([\d.]+);", rule)
        scale = re.search(r"--accent-c: ([\d.]+);", rule)
        if hue is None or scale is None or name in colors:
            raise ValueError(f"Invalid accent preset: {name}")
        angle = math.radians(float(hue.group(1)))
        saturation = chroma * float(scale.group(1))
        a, b = saturation * math.cos(angle), saturation * math.sin(angle)
        l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
        m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
        s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
        linear = (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        )
        channels = []
        for channel in linear:
            channel = min(1, max(0, channel))
            encoded = 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055
            channels.append(math.floor(encoded * 255 + 0.5))
        colors[name] = tuple(channels) + (255,)
    if "blue" not in colors or len(colors) < 2:
        raise ValueError("Missing accent presets")
    return colors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--styles", type=Path, default=STYLES)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    layers = rectangles(args.source)
    backgrounds = [index for index, layer in enumerate(layers) if layer[:4] == (0, 0, 128, 128)]
    if len(backgrounds) != 1 or any(
        layer[4] != (255, 255, 255, 255)
        for index, layer in enumerate(layers)
        if index != backgrounds[0]
    ):
        raise ValueError("Expected one icon background and a white symbol")
    variants = {"icon": layers}
    for name, fill in accent_colors(args.styles).items():
        if name == "blue":
            continue
        variant = layers.copy()
        index = backgrounds[0]
        variant[index] = (*variant[index][:4], fill)
        variants[f"accent-{name}"] = variant
    if not args.check:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, variant in variants.items():
        for size in SIZES:
            path = args.output_dir / f"{name}-{size}.png"
            expected = png(size, variant)
            if args.check:
                if not path.exists() or decoded(path.read_bytes()) != decoded(expected):
                    raise SystemExit(f"Icon is out of date: {path}")
            else:
                path.write_bytes(expected)


if __name__ == "__main__":
    main()
