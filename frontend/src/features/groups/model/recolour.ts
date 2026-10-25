import { useEffect, useState } from 'react'
import type { PortraitId } from './avatar'

/* ============================================================================
   The recolour layers, and the colour maths that drives them.

   A layer is a mask (an SVG path in a 100-unit box) plus the region's own
   brightness: its darkest, typical and brightest values. The renderer reads
   each masked pixel's brightness, maps darkest → typical → brightest onto 0
   → 0.5 → 1, and looks that up in a ramp built from the chosen colour, from
   its shadow to its highlight. The region's usual shade lands on the colour
   the member picked, and every fold and highlight keeps its place.

   The layers load only when a portrait is actually recoloured. A member
   who keeps the portrait as painted never downloads them.
   ========================================================================= */

export type Layer = { d: string; lum: [number, number, number] }
/** `beard` exists only on the portraits with a full beard. It takes the hair
    colour, laid on more lightly than the hair itself. */
export type Layers = { hair: Layer; skin: Layer; outfit: Layer; beard?: Layer }

const loaders = import.meta.glob<Layers>('./layers/*.json', { import: 'default' })
const cache = new Map<PortraitId, Layers>()
const pending = new Map<PortraitId, Promise<Layers>>()

function load(id: PortraitId): Promise<Layers> {
  let p = pending.get(id)
  if (!p) {
    const loader = loaders[`./layers/${id}.json`]
    p = loader
      ? loader().then((l) => {
          cache.set(id, l)
          return l
        })
      : Promise.reject(new Error(`no layers for ${id}`))
    pending.set(id, p)
  }
  return p
}

/** The portrait's layers once loaded, or undefined while they are on their
    way (or not wanted). The portrait draws as painted until then. */
export function useLayers(id: PortraitId, wanted: boolean): Layers | undefined {
  const [, bump] = useState(0)
  const ready = cache.get(id)
  useEffect(() => {
    if (!wanted || ready) return
    let live = true
    load(id)
      .then(() => live && bump((n) => n + 1))
      .catch(() => {
        /* the portrait stays as painted */
      })
    return () => {
      live = false
    }
  }, [id, wanted, ready])
  return wanted ? ready : undefined
}

/* --- Colour --------------------------------------------------------------- */

/** oklch → linear-light sRGB → gamma sRGB, each channel 0..1, clamped. */
export function oklchToRgb([l, c, h]: [number, number, number]): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const gamma = (x: number) =>
    Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
  return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2])]
}

/** How far a ramp reaches either side of its base colour, in oklch lightness.
    Hair carries the deepest shadows and brightest sheen of any part. */
const SPREAD = { hair: 0.48, skin: 0.3, outfit: 0.46, beard: 0.44 } as const

/** Five colours from shadow to highlight around a base.

    Hair and cloth lose chroma at both ends, as anything lit does. Skin does
    not: its shadows are richer and redder than its lit side, because light
    travels through skin before it comes back out. A skin ramp that greyed its
    shadows is what made the lightest tones look like wax. */
export function ramp(
  base: [number, number, number],
  part: keyof typeof SPREAD,
): [number, number, number][] {
  const [l, c, h] = base
  const s = SPREAD[part]
  const skin = part === 'skin'
  return [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const ll = Math.min(skin ? 0.93 : 0.97, Math.max(0.06, l + (t - 0.5) * s))
    const cc = skin ? c * (1.25 - t * 0.45) : c * (1 - Math.abs(t - 0.5) * 0.7)
    const hh = skin ? h - (1 - t) * 14 : h + (t - 0.5) * 6
    return oklchToRgb([ll, cc, hh])
  })
}

/** feComponentTransfer table values that send darkest → 0, typical → 0.5,
    brightest → 1, piecewise linear, sampled at 21 points. */
export function normaliseTable([lo, mid, hi]: [number, number, number]): string {
  const out: string[] = []
  for (let i = 0; i <= 20; i++) {
    const x = i / 20
    const y =
      x <= lo ? 0 : x >= hi ? 1 : x <= mid ? ((x - lo) / (mid - lo)) * 0.5 : 0.5 + ((x - mid) / (hi - mid)) * 0.5
    out.push(y.toFixed(3))
  }
  return out.join(' ')
}
