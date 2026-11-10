"""Icon set for "My Todo List": two rows, one ticked off, one still to do.

Drawn at 4x and downsampled, so the strokes are clean at 48px, which is where a
launcher icon is actually judged.

The adaptive foreground is NOT the square icon with the background removed.
Android crops an adaptive icon to whatever shape the launcher wants, and only
the central 66% is guaranteed to survive. So the mark is drawn, cropped to its
own bounding box, then centred and scaled against the rule Android states.
"""
from PIL import Image, ImageDraw

S = 1024
K = 4
C = S * K

BG   = (230, 244, 254)  # #E6F4FE — must match android.adaptiveIcon.backgroundColor
BLUE = (31, 95, 209)    # #1F5FD1 — the app's accent, the same blue as its buttons
INK  = (20, 23, 28)     # #14171C — the app's text colour


def check(d, cx, cy, size, w, colour):
    p1 = (cx - size * 0.40, cy + size * 0.02)
    p2 = (cx - size * 0.10, cy + size * 0.32)
    p3 = (cx + size * 0.42, cy - size * 0.33)
    for a, b in ((p1, p2), (p2, p3)):
        d.line([a, b], fill=colour, width=int(w))
    for p in (p1, p2, p3):  # round the caps and the join
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=colour)


def draw_mark(mono=False):
    """The mark alone, on transparency."""
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ink  = (0, 0, 0) if mono else INK
    blue = (0, 0, 0) if mono else BLUE
    bw, bh = C * 0.30, C * 0.095
    x, gap = C * 0.47, C * 0.115
    for i, y in enumerate((C * 0.5 - gap, C * 0.5 + gap)):
        d.rounded_rectangle([x, y - bh / 2, x + bw, y + bh / 2], radius=bh / 2, fill=ink + (255,))
        if i == 0:
            check(d, C * 0.355, y, C * 0.155, C * 0.072, blue + (255,))
        else:
            rr = C * 0.052
            d.ellipse([C * 0.355 - rr, y - rr, C * 0.355 + rr, y + rr],
                      outline=ink + (255,), width=int(C * 0.024))
    return im


def centred(mark, bbox_frac):
    """Crop to the content, centre it, and scale so its BOUNDING BOX is
    `bbox_frac` of the canvas side.

    The limit is a square, not a circle. Android: layers are 108x108 dp, "the
    inner 66x66 dp of the icon appears within the masked viewport", and a logo
    "must not exceed 66x66 dp" -- a centred square of 66/108 = 0.611 of the
    side, never clipped by any OEM mask.

    This file previously measured the half-DIAGONAL against 0.330, which is a
    different test (and 72/108, the "usually visible" bound, not the guaranteed
    one). It left this mark at 0.492 of the side where 0.611 was allowed: not
    wrong, just drawn smaller than it had to be.
    """
    box = mark.getbbox()
    m = mark.crop(box)
    k = (bbox_frac * C) / max(m.width, m.height)
    m = m.resize((max(1, int(m.width * k)), max(1, int(m.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    out.paste(m, ((C - m.width) // 2, (C - m.height) // 2), m)
    return out


def save(im, name):
    im.resize((S, S), Image.LANCZOS).save(f'assets/{name}')
    print('wrote', name)


mark, mono = draw_mark(), draw_mark(mono=True)

# 0.58 of the side, against the 0.611 the safe zone allows: filling it exactly
# would leave nothing for a squircle mask to round off.
fg = centred(mark, 0.58)
save(fg, 'android-icon-foreground.png')
save(centred(mono, 0.58), 'android-icon-monochrome.png')
save(Image.new('RGBA', (C, C), BG + (255,)), 'android-icon-background.png')

# The square icon is not cropped to a circle, so it can carry a larger mark.
sq = Image.new('RGBA', (C, C), BG + (255,))
big = centred(mark, 0.66)   # the square icon is not masked, so it can be bigger
sq.paste(big, (0, 0), big)
save(sq, 'icon.png')

# Splash: the mark on transparency, the window supplies the background.
save(centred(mark, 0.50), 'splash-icon.png')
