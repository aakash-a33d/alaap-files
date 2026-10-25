"""
Build the recolour layers for the twelve group-session portraits.

Each portrait stays the finished image it is. What this produces, per portrait, is
three soft masks as SVG paths: the hair, the skin, and the outfit. The app draws the
portrait, then redraws each masked region through a gradient-map filter. That swaps
the colour and keeps the original shading, which is what keeps the portrait looking
like a lit 3D render rather than a flat recolour.

Why not trace the whole portrait to SVG: a trace that keeps the look is about 500KB
and 1,200 shapes per portrait; one small enough to ship looks posterised. A 384px
webp plus three traced masks is about 20KB.

    python scripts/avatars/build-layers.py resources/avatars/portraits-512 [PREVIEW.png]

The source is the 512px portraits named <gender>-<age>.webp, kept in
resources/avatars/portraits-512/. Never point it at frontend/public/avatars/: that
holds this script's own 384px output, and re-encoding it each run would soften the
portraits a little more every time. PREVIEW.png, if given, is a contact sheet with
hair, skin, outfit and beard tinted, for checking the masks by eye. Writes:

    frontend/public/avatars/<id>.webp                 the portrait, re-saved at 384px
    frontend/src/features/groups/model/layers/<id>.json  the three masks + luminance

Needs numpy, scipy, scikit-learn, pillow and vtracer. Masks come from seed points
picked by eye per portrait (SEEDS below): each class is the set of pixels whose
colour is close to that class's seed colours and which are connected to a seed. If
a portrait is replaced, re-pick its seeds against a gridded copy of it and re-run.
"""

import json
import os
import sys
import tempfile

import numpy as np
import vtracer
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from sklearn.neighbors import NearestNeighbors

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_IMG = os.path.join(ROOT, 'frontend', 'public', 'avatars')
OUT_JSON = os.path.join(ROOT, 'frontend', 'src', 'features', 'groups', 'model', 'layers')

WORK = 256      # segmentation resolution
SHIP = 384      # shipped portrait size
TRACE = 256     # mask tracing resolution
VIEW = 100      # the SVG paths are written in a 100-unit box

# (x, y) as fractions of the image, picked against a 10x10 grid.
SEEDS = {
    'woman-child': {
        'hair': [(.5, .1), (.22, .5), (.78, .5), (.2, .3), (.8, .3), (.5, .25), (.25, .7), (.75, .7), (.27, .62),
                 (.73, .62), (.3, .76), (.7, .76), (.36, .7), (.63, .7)],
        'glasses': [],
        'skin': [(.4, .68), (.6, .68), (.5, .72), (.42, .62), (.58, .62)],
        'outfit': [(.2, .9), (.8, .9), (.3, .97), (.7, .97), (.15, .85), (.85, .82), (.15, .82),
                   (.7, .85), (.3, .85)],
    },
    'woman-teen': {
        'hair': [(.5, .08), (.2, .5), (.8, .5), (.18, .75), (.82, .75), (.3, .2), (.25, .35),
                 (.75, .35), (.15, .62), (.85, .62), (.22, .9), (.8, .9), (.28, .82), (.72, .8)],
        'skin': [(.4, .5), (.6, .5), (.5, .6), (.5, .35), (.5, .66)],
        # her left eye is in shadow and too small for the white-of-the-eye test
        'eyes': [(.38, .39)],
        'outfit': [(.5, .92), (.45, .9), (.55, .85), (.5, .98), (.62, .95), (.4, .97),
                   (.45, .74), (.55, .74), (.9, .92), (.1, .92), (.88, .84)],
    },
    'woman-20s': {
        'hair': [(.5, .08), (.25, .45), (.75, .45), (.25, .75), (.78, .75)],
        'skin': [(.4, .5), (.6, .5), (.5, .35), (.5, .62), (.5, .75)],
        'outfit': [(.15, .92), (.85, .92), (.3, .95), (.7, .95)],
    },
    'woman-30s': {
        'hair': [(.5, .08), (.2, .4), (.8, .4), (.2, .7), (.8, .7)],
        'skin': [(.4, .45), (.6, .45), (.5, .32), (.5, .58), (.5, .7)],
        'outfit': [(.5, .9), (.2, .92), (.8, .92), (.5, .98)],
    },
    'woman-middle': {
        'hair': [(.5, .08), (.2, .45), (.8, .45), (.2, .7), (.8, .7), (.33, .18), (.3, .25)],
        'skin': [(.4, .45), (.6, .45), (.5, .3), (.5, .58), (.5, .75)],
        'outfit': [(.15, .92), (.85, .92), (.25, .85), (.75, .85)],
    },
    'woman-older': {
        'glasses': [],
        'hair': [(.5, .08), (.25, .25), (.75, .25), (.22, .45)],
        'skin': [(.4, .5), (.6, .5), (.5, .3), (.5, .6), (.4, .75)],
        'outfit': [(.1, .85), (.15, .95), (.75, .9), (.6, .95)],
    },
    'man-child': {
        'glasses': [],
        'hair': [(.5, .1), (.25, .25), (.75, .25), (.3, .4)],
        'skin': [(.35, .6), (.65, .6), (.5, .68), (.5, .75)],
        'outfit': [(.2, .9), (.8, .9), (.25, .8), (.75, .8)],
    },
    'man-teen': {
        'hair': [(.5, .08), (.25, .25), (.75, .25), (.3, .4)],
        'skin': [(.35, .55), (.65, .55), (.5, .4), (.5, .65)],
        'outfit': [(.5, .9), (.2, .92), (.8, .92), (.4, .8)],
    },
    'man-20s': {
        'hair': [(.5, .1), (.3, .2), (.7, .2), (.3, .3)],
        'skin': [(.4, .45), (.6, .45), (.5, .35), (.5, .6), (.5, .75)],
        'outfit': [(.15, .9), (.85, .9), (.3, .85), (.7, .85)],
    },
    'man-30s': {
        'hair': [(.5, .08), (.3, .2), (.7, .2), (.28, .3)],
        'skin': [(.4, .45), (.6, .45), (.5, .3), (.5, .55), (.5, .78), (.45, .82),
                 (.55, .84), (.42, .76), (.58, .76)],
        'beard': [(.5, .67), (.38, .6), (.62, .6), (.45, .58)],
        'beard_band': [(.56, .73)],
        'outfit': [(.2, .92), (.8, .92), (.4, .95), (.6, .95), (.38, .85), (.62, .85)],
    },
    'man-middle': {
        'hair': [(.5, .08), (.3, .15), (.7, .15), (.28, .3)],
        'skin': [(.4, .45), (.6, .45), (.5, .28), (.5, .55), (.5, .76), (.46, .74), (.54, .74)],
        'outfit': [(.15, .92), (.85, .92), (.3, .95), (.7, .95)],
        'keep': [(.42, .85), (.58, .85), (.45, .82), (.55, .82)],
    },
    'man-older': {
        'glasses': [],
        'hair': [(.5, .08), (.3, .15), (.7, .15), (.27, .3)],
        'skin': [(.4, .48), (.6, .48), (.5, .28), (.33, .52), (.5, .8)],
        'beard': [(.5, .68), (.4, .62), (.6, .62), (.45, .58), (.55, .58)],
        'beard_band': [(.53, .8)],
        'outfit': [(.15, .92), (.85, .92), (.2, .85), (.8, .85)],
        'keep': [(.5, .9), (.45, .96), (.55, .96), (.42, .84), (.58, .84)],
    },
}

# How far, in Lab units, a pixel may be from its class's nearest seed colour.
REACH = {'hair': 20, 'skin': 16, 'outfit': 20, 'beard': 14, 'keep': 18}
# How much lightness counts in that distance. Lit and shaded skin differ mostly in
# lightness, so skin tests mostly hue and saturation: the bright side of a face is
# still face.
L_WEIGHT = {'skin': 0.35}
# Lab units per pixel of distance at WORK size, when classes compete for a pixel.
SPATIAL = 0.35


def to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def background(lab):
    """The backdrop: a smooth gradient, so fit one to the border and take every pixel
    close to it that is connected to the edge."""
    yy, xx = np.mgrid[0:WORK, 0:WORK] / WORK
    basis = np.stack([np.ones_like(xx), xx, yy, xx * yy, xx ** 2, yy ** 2], -1)
    band = np.zeros((WORK, WORK), bool)
    b = WORK // 25
    band[:b], band[-b:], band[:, :b], band[:, -b:] = True, True, True, True
    # the shoulders reach the bottom edge, so fit on the top two thirds of the band
    band[int(WORK * 0.66):, :] = False
    band[:b] = True
    coef, *_ = np.linalg.lstsq(basis[band], lab[band], rcond=None)
    fit = basis @ coef
    near = np.linalg.norm(lab - fit, axis=-1) < 9
    labels, _ = ndimage.label(near)
    edge = set(np.unique(np.concatenate([labels[0], labels[:, 0], labels[:, -1]]))) - {0}
    return np.isin(labels, list(edge))


def segment(img, seeds):
    seeds = dict(seeds)
    band_rows = (seeds.pop('beard_band', None) or [(0.55, 0.73)])[0]
    glasses = seeds.pop('glasses', None) is not None
    named_eyes = seeds.pop('eyes', [])
    rgb = np.asarray(img.resize((WORK, WORK), Image.LANCZOS).convert('RGB'), dtype=np.float64)
    lab = to_lab(rgb)
    bg = background(lab)

    # Every class competes for every pixel. Position counts as well as colour, so a
    # shadowed cheek goes to the skin beside it rather than to a hair highlight of
    # the same brown on the other side of the head.
    yy, xx = np.mgrid[0:WORK, 0:WORK]
    feat = np.concatenate([lab, np.stack([xx, yy], -1) * SPATIAL], -1)
    classes = list(seeds)
    samples, owner, seed_px = [], [], {}
    for k, cls in enumerate(classes):
        seed_px[cls] = []
        for x, y in seeds[cls]:
            cx, cy = int(x * WORK), int(y * WORK)
            seed_px[cls].append((cy, cx))
            patch = feat[max(cy - 3, 0):cy + 4, max(cx - 3, 0):cx + 4].reshape(-1, 5)
            samples.append(patch)
            owner += [k] * len(patch)
    samples, owner = np.concatenate(samples), np.array(owner)
    nn = NearestNeighbors(n_neighbors=1).fit(samples)
    _, idx = nn.kneighbors(feat.reshape(-1, 5))
    winner = owner[idx[:, 0]].reshape(WORK, WORK)
    # Colour distance alone decides whether a pixel belongs to any class at all.
    # Eyes, teeth, glasses and an undershirt are near none of them and stay as drawn.
    masks = {}
    for k, cls in enumerate(classes):
        w = np.array([L_WEIGHT.get(cls, 1.0), 1.0, 1.0])
        nn_c = NearestNeighbors(n_neighbors=1).fit(samples[owner == k][:, :3] * w)
        dist, _ = nn_c.kneighbors(lab.reshape(-1, 3) * w)
        near = (dist[:, 0] < REACH[cls]).reshape(WORK, WORK)
        if cls == 'skin':
            skin_like = near & ~bg
        m = (winner == k) & near & ~bg
        m = ndimage.binary_closing(m, iterations=1)
        labels, _ = ndimage.label(m)
        keep = {labels[p] for p in seed_px[cls] if labels[p] > 0}
        m = np.isin(labels, list(keep))
        # Small holes are shading the colour test missed; the large ones are eyes
        # and mouths and must stay holes in the skin.
        holes = ndimage.binary_fill_holes(m) & ~m
        hl, n = ndimage.label(holes)
        if n:
            sizes = ndimage.sum(holes, hl, range(1, n + 1))
            for i, s in enumerate(sizes, 1):
                if s < (40 if cls != 'skin' else 12):
                    m |= hl == i
        m = ndimage.binary_opening(m, iterations=1)
        masks[cls] = m
    # Where two classes overlap, the one with the nearer seed colour wins is too
    # fine a call to make here; skin gives way to hair and outfit, which keeps
    # eyebrows and collars from being painted skin colour.
    # A full beard is its own layer: its colour is nothing like the hair on the head,
    # and its edge fades into skin, so the app lays the hair colour over it more
    # lightly. Stubble is not seeded as beard at all: it is skin with hairs in it,
    # and goes with the skin.
    # `keep` is seeded on things that must stay as drawn (a shirt under a jacket, a
    # collar), only so it can win those pixels from the classes that are recoloured.
    masks.pop('keep', None)
    seed_px.pop('keep', None)
    beard = masks.pop('beard', None)
    seed_px.pop('beard', None)

    # Inside the face, anything thin that reached the hair class is a glasses frame
    # or an iris, not hair. Open it away there only, so wisps at the hairline stay.
    # Closed before filling, so the eyes count as inside the face even where an
    # eye's outline touches the hair.
    face = ndimage.binary_fill_holes(ndimage.binary_closing(masks['skin'], iterations=8))
    face = ndimage.binary_dilation(face, iterations=2)
    # What is left inside the face is kept only near the face's edge, where a fringe
    # overlaps it. An iris sits deeper than that, even when lashes and a brow join
    # it to the hairline.
    inner = ndimage.binary_opening(masks['hair'] & face, iterations=2)
    inner &= ndimage.distance_transform_edt(face) < WORK * 0.04
    # And an iris always sits beside the white of its eye, which nothing else on a
    # face is. Anything within an iris's width of that white is eye, not hair, even
    # where the hair touches the eye and the face's outline never closed round it.
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    # Whites of the eyes are near-white, in the eye band of these portraits, and
    # touch something dark (the iris or the lash line). Grey hair's highlights are
    # near-white too, but are not beside anything that dark.
    near_face = ndimage.binary_dilation(face, iterations=int(WORK * 0.04))
    band = np.zeros_like(face)
    band[int(WORK * 0.28):int(WORK * 0.55)] = True
    sclera = near_face & band & (lab[..., 0] > 70) & (chroma < 20) & ~bg
    sclera = ndimage.binary_opening(sclera, iterations=1)
    dark = ndimage.binary_dilation(lab[..., 0] < 35, iterations=4)
    sl, n = ndimage.label(sclera)
    beside = set(np.unique(sl[sclera & dark])) - {0}
    sclera = np.isin(sl, list(beside))
    for x, y in named_eyes:
        sclera[int(y * WORK), int(x * WORK)] = True
    eyes = ndimage.binary_dilation(sclera, iterations=int(WORK * 0.03))
    was_hair = masks['hair']
    hair = ((masks['hair'] & ~face) | inner) & ~eyes
    # Glasses frames are near-black and colourless, which brown hair is not. On the
    # four portraits that wear them, such pixels around the face are frames, and
    # keep their own colour whatever the hair becomes.
    if glasses:
        around = ndimage.binary_dilation(face, iterations=int(WORK * 0.02))
        frames = around & (lab[..., 0] < 26) & (chroma < 12)
        hair &= ~ndimage.binary_dilation(frames, iterations=1)
    labels, _ = ndimage.label(hair)
    keep = {labels[p] for p in seed_px['hair'] if labels[p] > 0}
    masks['hair'] = np.isin(labels, list(keep))
    # Eyelid and cheek around an eye that had been taken for hair go to the skin.
    masks['skin'] |= was_hair & eyes & skin_like & ~masks['hair'] & ~sclera

    if beard is not None:
        # A beard lives between the nose and the jaw (`beard_band`, per portrait);
        # anything the colour test found above or below that is an eye or a
        # shadowed neck.
        band = np.zeros_like(beard)
        top, bottom = band_rows
        band[int(WORK * top):int(WORK * bottom)] = True
        masks['beard'] = ndimage.binary_opening(beard & band & ~masks['hair'], iterations=1)
        # what was cut off is cheek and neck, so it goes back to the skin
        masks['skin'] |= beard & ~masks['beard'] & ~eyes & ~masks['hair']
        masks['skin'] &= ~masks['beard']
    masks['skin'] &= ~masks['hair'] & ~masks['outfit']
    masks['outfit'] &= ~masks['hair']
    return rgb, masks


def trace(mask):
    # Traced at 256 and smoothed first: the app feathers every mask edge anyway, so
    # outline detail finer than that is bytes nobody can see.
    big = Image.fromarray((mask * 255).astype(np.uint8)).resize((TRACE, TRACE), Image.BILINEAR)
    big = big.filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: 255 if v > 127 else 0)
    # vtracer traces dark shapes in binary mode
    inv = Image.eval(big, lambda v: 255 - v).convert('RGB')
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, 'm.png'), os.path.join(d, 'm.svg')
        inv.save(src)
        vtracer.convert_image_to_svg_py(
            src, dst, colormode='binary', mode='spline', filter_speckle=8,
            corner_threshold=90, length_threshold=6.0, splice_threshold=60, path_precision=1,
        )
        svg = open(dst).read()
    import re
    paths = []
    for m in re.finditer(r'<path d="([^"]+)"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"', svg):
        d, tx, ty = m.group(1), float(m.group(2)), float(m.group(3))
        paths.append(rescale(d, tx, ty))
    return ' '.join(paths)


def rescale(d, tx, ty):
    """Move a traced path into the 100-unit box, rounding to 0.1."""
    import re
    s = VIEW / TRACE
    toks = re.findall(r'[A-Za-z]|-?\d+(?:\.\d+)?', d)
    out, i, cmd, xy = [], 0, '', 0
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd, xy = t, 0
            out.append(t)
        else:
            v = float(t)
            v = (v + (tx if xy % 2 == 0 else ty)) * s if cmd.isupper() else v * s
            out.append(f'{v:.1f}'.rstrip('0').rstrip('.'))
            xy += 1
        i += 1
    return ' '.join(out).replace(' -', '-')


def luminance_range(rgb, mask):
    y = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[mask] / 255.0
    # [darkest, typical, brightest], trimmed so a stray eyelash or a specular glint
    # does not set the range. The app maps these to the dark end, middle and light
    # end of the chosen colour, so the region's usual shade lands on that colour.
    if y.size == 0:
        return [0.0, 0.5, 1.0]
    lo, mid, hi = np.percentile(y, 5), np.percentile(y, 50), np.percentile(y, 97)
    mid = min(max(mid, lo + 0.02), hi - 0.02)
    return [round(float(lo), 3), round(float(mid), 3), round(float(max(hi, lo + 0.05)), 3)]


def main():
    src = sys.argv[1]
    preview = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(OUT_JSON, exist_ok=True)
    tiles = []
    for pid, seeds in SEEDS.items():
        img = Image.open(os.path.join(src, pid + '.webp')).convert('RGB')
        rgb, masks = segment(img, seeds)
        layers = {}
        for cls in ('hair', 'skin', 'outfit', 'beard'):
            if cls in masks:
                layers[cls] = {'d': trace(masks[cls]), 'lum': luminance_range(rgb, masks[cls])}
        with open(os.path.join(OUT_JSON, pid + '.json'), 'w') as f:
            json.dump(layers, f, separators=(',', ':'))
        if preview:
            tint = np.asarray(img.resize((WORK, WORK)), dtype=np.float64)
            for cls, col in (('hair', (255, 0, 0)), ('skin', (0, 200, 0)), ('outfit', (0, 90, 255)),
                             ('beard', (255, 160, 0))):
                if cls not in masks:
                    continue
                tint[masks[cls]] = tint[masks[cls]] * 0.45 + np.array(col) * 0.55
            t = Image.fromarray(tint.astype(np.uint8))
            ImageDraw.Draw(t).text((3, 3), pid, fill=(0, 0, 0))
            tiles.append(t)
        size = sum(len(v['d']) for v in layers.values())
        print(f'{pid:14s} masks {size / 1024:.1f}KB  lum ' +
              ' '.join(f"{k}={v['lum']}" for k, v in layers.items()))
    for pid in SEEDS:
        p = os.path.join(src, pid + '.webp')
        Image.open(p).convert('RGB').resize((SHIP, SHIP), Image.LANCZOS).save(
            os.path.join(OUT_IMG, pid + '.webp'), 'WEBP', quality=84, method=6)
    if preview:
        sheet = Image.new('RGB', (WORK * 6, WORK * 2), 'white')
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 6) * WORK, (i // 6) * WORK))
        sheet.save(preview)


if __name__ == '__main__':
    main()
