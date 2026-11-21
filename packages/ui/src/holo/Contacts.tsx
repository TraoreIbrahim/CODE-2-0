import { useContext } from 'react'
import type { UiContact, UiContacts } from '@code/protocol'
import { Api } from './api.ts'
import { Sigil, Tag } from './PersoViews.tsx'

/**
 * Contacts : une seule personne, sa fiche (coordonnées, derniers mails, prochains rendez-vous) ;
 * plusieurs, des cartes côte à côte, pour choisir.
 */
export function ContactsView({ data }: { data: UiContacts }) {
  if (!data.contacts.length)
    return (
      <div className="perso contacts">
        <p className="contacts__vide">Personne ne correspond à « {data.requete} ».</p>
      </div>
    )
  return data.contacts.length === 1 ? <Fiche c={data.contacts[0]!} data={data} /> : <Cartes data={data} />
}

function Fiche({ c, data }: { c: UiContact; data: UiContacts }) {
  const { ask } = useContext(Api)
  return (
    <div className="perso contacts contacts--fiche">
      <header className="contacts__tete">
        <Sigil text={c.initiales} size={64} />
        <div className="contacts__qui">
          <h3>{c.nom}</h3>
          {(c.fonction || c.organisation) && <p>{[c.fonction, c.organisation].filter(Boolean).join(' · ')}</p>}
        </div>
        {c.echange && <Tag b={{ label: 'HORS CARNET', tone: 'neutre' }} />}
      </header>
      <dl className="contacts__coord">
        {c.emails.map((e) => (
          <Ligne key={e} label="MAIL">
            <a href={`mailto:${e}`}>{e}</a>
          </Ligne>
        ))}
        {c.telephones.map((t) => (
          <Ligne key={t.numero} label={(t.type ?? 'TÉL.').toUpperCase()}>
            <a href={`tel:${t.numero.replace(/[^\d+]/g, '')}`}>{t.numero}</a>
          </Ligne>
        ))}
        {c.adresse && <Ligne label="ADRESSE">{c.adresse}</Ligne>}
        {c.anniversaire && <Ligne label="ANNIVERSAIRE">{c.anniversaire}</Ligne>}
      </dl>
      {(data.mails?.length || data.rendezVous?.length) ? (
        <div className="contacts__liens">
          {data.mails && data.mails.length > 0 && (
            <section>
              <h4 className="code-mono">DERNIERS MAILS</h4>
              <ul>
                {data.mails.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={m.nonLu ? 'is-nonlu' : ''} onClick={() => ask(`Montre-moi le mail « ${m.objet} » de ${c.nom}.`)}>
                      <span>{m.objet}</span>
                      <small className="code-mono">{m.quand}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.rendezVous && data.rendezVous.length > 0 && (
            <section>
              <h4 className="code-mono">PROCHAINS RENDEZ-VOUS</h4>
              <ul>
                {data.rendezVous.map((r) => (
                  <li key={`${r.titre}${r.quand}`}>
                    <span>{r.titre}</span>
                    <small className="code-mono">{r.quand}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contacts__ligne">
      <dt className="code-mono">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Cartes({ data }: { data: UiContacts }) {
  const { ask } = useContext(Api)
  return (
    <div className="perso contacts">
      <p className="contacts__compte code-mono">
        {data.contacts.length} PERSONNES · « {data.requete.toUpperCase()} »
      </p>
      <ul className="contacts__grille">
        {data.contacts.map((c, i) => (
          <li key={`${c.nom}${c.emails[0] ?? i}`} style={{ animationDelay: `${i * 50}ms` }}>
            <button type="button" className="contacts__carte" onClick={() => ask(`Montre-moi la fiche de ${c.nom}${c.emails[0] ? ` (${c.emails[0]})` : ''}.`)}>
              <Sigil text={c.initiales} size={40} />
              <span className="contacts__carte-texte">
                <strong>{c.nom}</strong>
                {(c.fonction || c.organisation) && <small>{[c.fonction, c.organisation].filter(Boolean).join(' · ')}</small>}
                {c.emails[0] && c.emails[0] !== c.nom && <small className="code-mono">{c.emails[0]}</small>}
                {c.telephones[0] && <small className="code-mono">{c.telephones[0].numero}</small>}
                {c.echange && <Tag b={{ label: 'HORS CARNET', tone: 'neutre' }} />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
