"""Render the trip-configuration icons (services, cash, QR) to PNG.

The app has no SVG renderer, so these duotone icons ship as @1x/@2x/@3x PNGs,
one set per theme. Edit the drawings below and run, from `mobile/`:

    uvx --with cairosvg python scripts/render_trip_option_icons.py
"""

from __future__ import annotations

from pathlib import Path

import cairosvg

OUT = Path(__file__).resolve().parents[1] / "assets" / "images" / "trip-options"
BASE_SIZE = 40

PALETTES = {
    "light": {
        "ink": "#16308C", "soft": "#DCE6FF", "accent": "#F5C518", "paper": "#FFFFFF",
        "cash_ink": "#167347", "cash_back": "#B8E3CB", "cash_front": "#E8F5EE",
        "cash_coin": "#FFFFFF", "cash_text": "#167347",
    },
    "dark": {
        "ink": "#F3F6FC", "soft": "#3B4F7A", "accent": "#F5C518", "paper": "#10151F",
        "cash_ink": "#83DEAE", "cash_back": "#2A5A48", "cash_front": "#193C31",
        "cash_coin": "#83DEAE", "cash_text": "#193C31",
    },
}

ICONS = {
    "taxi": """
<path d="M16 8.2v1.1"/>
<rect x="12.5" y="5" width="7" height="3.2" rx="1" fill="{accent}"/>
<path d="M4 21.5v-4.2c0-.9.6-1.7 1.4-2l2.8-1.1 2.6-4.3a2 2 0 0 1 1.7-1h7a2 2 0 0 1 1.7 1
  l2.6 4.3 2.8 1.1c.8.3 1.4 1.1 1.4 2v4.2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="{accent}"/>
<path d="M10.8 14l1.9-3.2h2.8V14zM17.5 14v-3.2h2.8l1.9 3.2z" fill="{paper}"/>
<path d="M13 18h6"/>
<circle cx="10" cy="22.5" r="2.8" fill="{ink}"/><circle cx="22" cy="22.5" r="2.8" fill="{ink}"/>
<circle cx="10" cy="22.5" r="1" fill="{paper}" stroke="none"/>
<circle cx="22" cy="22.5" r="1" fill="{paper}" stroke="none"/>
""",
    "moto": """
<path d="M24.5 22l-2.6-11.5M20 9h3.8"/>
<path d="M11 21.5h8.3c.9 0 1.6-.5 1.9-1.3l2.2-6.2H17l-2.4 4H11.2z" fill="{soft}"/>
<path d="M11 16.3h5.5" stroke-width="3"/>
<circle cx="7.5" cy="22" r="3.8" fill="{paper}"/><circle cx="24.5" cy="22" r="3.8" fill="{paper}"/>
<circle cx="7.5" cy="22" r="1.2" fill="{ink}" stroke="none"/>
<circle cx="24.5" cy="22" r="1.2" fill="{ink}" stroke="none"/>
<circle cx="23.6" cy="12.2" r="1.1" fill="{accent}"/>
""",
    "delivery": """
<path d="M16 4.5l10.5 5v13L16 27.5l-10.5-5v-13z" fill="{soft}"/>
<path d="M5.5 9.5L16 14.5l10.5-5L16 4.5z" fill="{accent}"/>
<path d="M16 14.5v13"/>
<path d="M10.8 7l10.5 5v4.5" stroke-width="2.2"/>
<path d="M19.5 22.5l3.5-1.7"/>
""",
    "moving": """
<rect x="3" y="7.5" width="16" height="14" rx="1.5" fill="{soft}"/>
<path d="M6 11h4.5v4.5H6zM11.5 12.5H15V16h-3.5z" fill="{accent}"/>
<path d="M19 12h5c.6 0 1.1.3 1.4.8l2.6 4.1V21a1 1 0 0 1-1 1H19z" fill="{ink}"/>
<path d="M20.5 13.5h3.2l1.8 3h-5z" fill="{paper}" stroke="none"/>
<circle cx="8" cy="22.5" r="2.7" fill="{paper}"/><circle cx="23" cy="22.5" r="2.7" fill="{paper}"/>
""",
    "cash": """
<g stroke="{cash_ink}">
<rect x="6.5" y="6.5" width="22" height="13.5" rx="2.5" fill="{cash_back}"/>
<rect x="3.5" y="10.5" width="22" height="13.5" rx="2.5" fill="{cash_front}"/>
<circle cx="14.5" cy="17.25" r="4" fill="{cash_coin}"/>
<path d="M7 14v0M22 20.5v0" stroke-width="2.4"/>
</g>
<text x="14.5" y="19.4" text-anchor="middle" font-size="5.6" font-weight="700"
  font-family="sans-serif" fill="{cash_text}" stroke="none">Bs</text>
""",
    "qr": """
<rect x="5" y="5" width="9" height="9" rx="2" fill="{soft}"/>
<rect x="18" y="5" width="9" height="9" rx="2" fill="{soft}"/>
<rect x="5" y="18" width="9" height="9" rx="2" fill="{soft}"/>
<path d="M8.5 8.5h2v2h-2zM21.5 8.5h2v2h-2zM8.5 21.5h2v2h-2z" fill="{ink}"/>
<path d="M18 18h3.5v3.5M25 18h2M27 22v5h-4.5M18 25v2"/>
""",
}


def svg(body: str, palette: dict[str, str]) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" '
        f'stroke="{palette["ink"]}" stroke-width="1.6" stroke-linejoin="round" '
        f'stroke-linecap="round">{body.format(**palette)}</svg>'
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for theme, palette in PALETTES.items():
        for name, body in ICONS.items():
            source = svg(body, palette).encode()
            for scale in (1, 2, 3):
                suffix = "" if scale == 1 else f"@{scale}x"
                cairosvg.svg2png(
                    bytestring=source,
                    write_to=str(OUT / f"{name}-{theme}{suffix}.png"),
                    output_width=BASE_SIZE * scale,
                    output_height=BASE_SIZE * scale,
                )


if __name__ == "__main__":
    main()
