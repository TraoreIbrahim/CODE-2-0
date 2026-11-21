/**
 * Le décor Horizon : un sol quadrillé qui fuit vers une ligne d'horizon, et le reflet de l'orbe posé dessus.
 * Purement décoratif ; il se place sous l'orbe (son parent le positionne, voir `.horizon` dans theme.css).
 */
export function Horizon({ variant = 'phone' }: { variant?: 'phone' | 'mac' }) {
  return (
    <div className={`horizon horizon--${variant}`} aria-hidden="true">
      <div className="horizon__floor">
        <div className="horizon__grid" />
      </div>
      <div className="horizon__line" />
      <div className="horizon__reflet" />
    </div>
  )
}
