import { useRef, type ReactNode, type ElementType } from 'react'
import { gsap, useGSAP } from '../../utils/gsap'

type Props = {
  children: ReactNode
  as?: ElementType
  className?: string
  /** seconds of delay before this element begins */
  delay?: number
  /** stagger direct children instead of moving the wrapper itself */
  stagger?: number
  y?: number
}

/**
 * Fades content up as it enters the viewport. Under prefers-reduced-motion the
 * element is simply present — no transform, no opacity ramp.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  className = '',
  delay = 0,
  stagger,
  y = 26,
}: Props) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      const mm = gsap.matchMedia()

      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const { reduced } = ctx.conditions as { reduced: boolean }
          if (reduced) {
            gsap.set(el, { opacity: 1, y: 0 })
            if (stagger) gsap.set(el.children, { opacity: 1, y: 0 })
            return
          }

          const targets = stagger ? Array.from(el.children) : el

          gsap.fromTo(
            targets,
            { opacity: 0, y },
            {
              opacity: 1,
              y: 0,
              duration: 0.85,
              delay,
              ease: 'power3.out',
              stagger: stagger ?? 0,
              /* Drop the inline transform once the reveal lands. GSAP leaves
                 `transform: translate(0,0)` behind, and an inline transform
                 outranks any CSS `:hover` rule — which silently killed the
                 lift on the pricing cards. The end state is y:0, so removing
                 it changes nothing visually. */
              clearProps: 'transform',
              scrollTrigger: {
                trigger: el,
                start: 'top 86%',
                toggleActions: 'play none none none',
              },
            },
          )
        },
      )

      return () => mm.revert()
    },
    { scope: ref },
  )

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  )
}
