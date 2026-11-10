"""Icon set for "My Todo List": two rows, one ticked off, one still to do.

Drawn at 4x and downsampled, so the strokes are clean at 48px, which is where a
launcher icon is actually judged.

The adaptive foreground is NOT the square icon with the background removed.
Android crops an adaptive icon to whatever shape the launcher wants, and only
the central 66% is guaranteed to survive. So the mark is drawn, cropped to its
own bounding box, then centred and scaled until its half-diagonal fits inside
that circle with room to spare. Measured, not eyeballed: the raw composition
sat at 0.315 of the canvas against a 0.33 limit, which is inside but has no
margin for a launcher that crops a little harder.
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


def centred(mark, half_diag_frac):
    """Crop the mark to its own bounds, then centre it on a square canvas scaled
    so its half-diagonal is `half_diag_frac` of the side."""
    box = mark.getbbox()
    m = mark.crop(box)
    half = (m.width ** 2 + m.height ** 2) ** 0.5 / 2
    scale = (half_diag_frac * C) / half
    m = m.resize((max(1, int(m.width * scale)), max(1, int(m.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    out.paste(m, ((C - m.width) // 2, (C - m.height) // 2), m)
    return out


def save(im, name):
    im.resize((S, S), Image.LANCZOS).save(f'assets/{name}')
    print('wrote', name)


mark, mono = draw_mark(), draw_mark(mono=True)

# 0.30 for the adaptive foreground: inside the 0.33 safe radius, with margin.
fg = centred(mark, 0.30)
save(fg, 'android-icon-foreground.png')
save(centred(mono, 0.30), 'android-icon-monochrome.png')
save(Image.new('RGBA', (C, C), BG + (255,)), 'android-icon-background.png')

# The square icon is not cropped to a circle, so it can carry a larger mark.
sq = Image.new('RGBA', (C, C), BG + (255,))
big = centred(mark, 0.345)
sq.paste(big, (0, 0), big)
save(sq, 'icon.png')

# Splash: the mark on transparency, the window supplies the background.
save(centred(mark, 0.26), 'splash-icon.png')
