/** Marca do Dental: um dente branco sobre o quadrado rosa-gengiva. */
export function LogoDente({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
      <rect width="34" height="34" rx="10" fill="#E0607E" />
      <path
        d="M10.2 10.6c1.9-1.6 4.3-1.5 6.8-.3 2.5-1.2 4.9-1.3 6.8.3 2 1.8 1.8 5 .7 8-1 2.6-1.3 5.6-2.4 6.4-1.3.9-2-1.4-2.6-3.4-.4-1.3-1-2.1-2.5-2.1s-2.1.8-2.5 2.1c-.6 2-1.3 4.3-2.6 3.4-1.1-.8-1.4-3.8-2.4-6.4-1.1-3-1.3-6.2.7-8z"
        fill="#fff"
      />
    </svg>
  )
}
