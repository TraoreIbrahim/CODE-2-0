import { NOM_ASSISTANT_DEFAUT } from '@code/protocol'

/**
 * La marque de CODE 2.0 : l'orbe « Onde » et son regard en écoute, figés comme sur l'icône de l'app
 * (`scripts/icones.mjs`, mêmes boucles). Elle prend la couleur du thème ; à 32 px et moins, deux boucles
 * plus épaisses et des yeux plus grands, pour rester lisible.
 */

const T = 4.8
const E = 0.25

function boucle(k: number, w: number, amp: number): string {
  let d = ''
  for (let i = 0; i <= 120; i++) {
    const th = (i / 120) * Math.PI * 2
    const r = 0.8 + amp * (0.35 + 1.3 * E) * (Math.sin(k * th + T * w) + 0.4 * Math.sin((k + 2) * th - T * w * 0.7))
    d += `${i ? 'L' : 'M'}${(256 + Math.cos(th) * r * 236).toFixed(1)} ${(256 + Math.sin(th) * r * 236).toFixed(1)}`
  }
  return `${d}Z`
}

/** [tracé, trait clair ?, épaisseur, opacité] */
const GRANDE = [boucle(3, 1.3, 0.07), boucle(5, -1.7, 0.06), boucle(7, 2.3, 0.045), boucle(2, -0.9, 0.08)].map((d, i) => [d, i % 2 === 1, [14, 9, 7, 6][i]!, [0.85, 0.7, 0.55, 0.45][i]!] as const)
const PETITE = GRANDE.slice(0, 2).map(([d, clair], i) => [d, clair, [30, 18][i]!, [0.95, 0.85][i]!] as const)

export function BrandMark({ size = 28 }: { size?: number }) {
  const petite = size <= 32
  const w = 236 * 0.15 * (petite ? 1.25 : 1)
  const h = 236 * 0.34 * (petite ? 1.1 : 1)
  const ey = 256 - 236 * 0.04
  return (
    <svg className="code-mark" viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      {(petite ? PETITE : GRANDE).map(([d, clair, lw, a], i) => (
        <path key={i} className={clair ? 'code-mark__onde code-mark__onde--clair' : 'code-mark__onde'} d={d} strokeWidth={lw} strokeOpacity={a} />
      ))}
      {[-1, 1].map((cote) => (
        <rect key={cote} className="code-mark__oeil" x={256 + cote * 236 * 0.3 - w / 2} y={ey - h / 2} width={w} height={h} rx={w / 2} />
      ))}
    </svg>
  )
}

/** La marque et le nom de l'assistant côte à côte, pour les en-têtes. */
export function Logo({ size = 28, nom = NOM_ASSISTANT_DEFAUT, className = '' }: { size?: number; nom?: string; className?: string }) {
  return (
    <span className={`code-logo ${className}`.trim()}>
      <BrandMark size={size} />
      <span className="code-brand code-logo__name">{nom}</span>
    </span>
  )
}
