import type { Variants, Transition } from 'framer-motion'

const easeInOut: Transition = { ease: 'easeInOut' }

/**
 * AI Chat aura pulse — complex multi-property animation
 * Replaces CSS @keyframes tcAiChatAuraPulse
 */
export const auraPulseTransition: Transition = {
  duration: 2.6,
  ease: [0.42, 0, 0.38, 1],
  repeat: Infinity,
  repeatType: 'loop',
}

export const auraPulseVariants: Variants = {
  idle: {
    scale: 0.99,
    x: -2,
    y: -1,
    rotate: -0.5,
    filter: 'blur(32px) saturate(1.18) hue-rotate(-6deg)',
    opacity: 0.9,
  },
  active: {
    scale: [0.99, 1.015, 1.01, 1.005, 0.99],
    x: [-2, 2, -1, 1, -2],
    y: [-1, -1, 3, 2, -1],
    rotate: [-0.5, 1, -1, 0.5, -0.5],
    filter: [
      'blur(32px) saturate(1.18) hue-rotate(-6deg)',
      'blur(35px) saturate(1.26) hue-rotate(10deg)',
      'blur(34px) saturate(1.22) hue-rotate(-4deg)',
      'blur(33px) saturate(1.2) hue-rotate(4deg)',
      'blur(32px) saturate(1.18) hue-rotate(-6deg)',
    ],
    opacity: [0.9, 0.86, 0.9, 0.88, 0.9],
    transition: auraPulseTransition,
  },
}

/**
 * AI Chat thinking breathe — opacity + translate + scale
 * Replaces the old pseudo-element breathing keyframes.
 */
export const thinkingBreatheVariants: Variants = {
  animate: {
    opacity: [0.38, 0.78, 0.38],
    x: ['0%', '10%', '0%'],
    scale: [0.96, 1.08, 0.96],
    transition: {
      duration: 2.8,
      ...easeInOut,
      repeat: Infinity,
    },
  },
}

/**
 * AI Chat bubble breath — scale breathing (was on ::before)
 * Replaces CSS @keyframes tcAiChatBubbleBreath
 */
export const bubbleBreathVariants: Variants = {
  animate: {
    scale: [0.96, 1.04, 0.96],
    transition: {
      duration: 2.8,
      ...easeInOut,
      repeat: Infinity,
    },
  },
}

/**
 * AI Chat bubble halo — scale + opacity breathing (was on ::after)
 * Replaces CSS @keyframes tcAiChatBubbleHalo
 */
export const bubbleHaloVariants: Variants = {
  animate: {
    scale: [0.92, 1.1, 0.92],
    opacity: [0.62, 0.96, 0.62],
    transition: {
      duration: 2.8,
      ...easeInOut,
      repeat: Infinity,
    },
  },
}

/**
 * Reduced motion check — use with useReducedMotion() from framer-motion
 * When reduced motion is preferred, pass "idle" or skip animation
 */
export const reducedMotionTransition: Transition = {
  duration: 0,
}
