import argparse
import struct
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

SOURCE = Path("assets/original/culverin-original-stats.svg")
OUTPUT = Path("extension/public/icons")
SIZES = (16, 32, 48, 128)
GRID = 128 // 16
NAMESPACE = "{http://www.w3.org/2000/svg}"


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
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    layers = rectangles(args.source)
    if not args.check:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = args.output_dir / f"icon-{size}.png"
        expected = png(size, layers)
        if args.check:
            if not path.exists() or path.read_bytes() != expected:
                raise SystemExit(f"Icon is out of date: {path}")
        else:
            path.write_bytes(expected)


if __name__ == "__main__":
    main()
