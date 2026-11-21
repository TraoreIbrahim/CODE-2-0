import { useEffect, useState } from 'react'
import { FOURNISSEURS, FOURNISSEUR_INFOS, ROLES_MOTEUR, ROLE_NOMS, type BancResultat, type ChoixMoteur, type FournisseurId, type ModeleInfo, type RoleMoteur } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { FieldError, registre } from './fields.tsx'

/**
 * Réglages › Moteurs : pour chaque usage (conversation, réponses rapides, tâches planifiées), le fournisseur
 * et le modèle, avec la clé de la personne. Le banc d'essai pose les mêmes demandes à un moteur et dit s'il
 * tient la route avec l'assistant (« testé », « limité »).
 * Deux présentations : `lignes` (l'assistant de premier lancement, une valeur soulignée par usage) et
 * `cartes` (les Réglages, une carte par usage côte à côte).
 */

type FieldProps = { code: Code; variante?: 'lignes' | 'cartes' }

const MODELE = /^[\w.:/@+-]{1,120}$/

const ETATS: Record<BancResultat['etat'], string> = { teste: 'TESTÉ', limite: 'LIMITÉ', echec: 'ÉCHEC', en_cours: 'EN COURS' }

const memeMoteur = (a: ChoixMoteur, b: ChoixMoteur) => a.fournisseur === b.fournisseur && a.modele === b.modele

/** Prix par million de tokens, entrée / sortie, comme les fournisseurs l'affichent. */
const prixTexte = (m: ModeleInfo | undefined) => (m?.prix ? `${dollars(m.prix.entree)} / ${dollars(m.prix.sortie)} par million de tokens` : null)
const dollars = (n: number) => `${n < 1 ? n.toFixed(2) : n.toFixed(n % 1 ? 2 : 0)} $`

/** Mémoire de travail minimale pour un modèle local : les consignes, les outils et la conversation (environ 8 000 tokens). */
const CONTEXTE_OLLAMA = 16_384

export function MoteursField({ code, variante = 'cartes' }: FieldProps) {
  const { moteurs, cles, connection, utilisateur, banc } = code.state
  const connected = connection === 'connecte'
  useEffect(() => {
    if (!connected) return
    code.client.requestMoteurs()
    code.client.requestCles()
  }, [connected, code.client])
  if (!utilisateur || !moteurs) return <p className="rg-note">Chargement…</p>
  const t = registre(utilisateur)
  /** Le fournisseur est utilisable : sa clé (la sienne ou, pour le propriétaire, celle du serveur), ou Ollama installé. */
  const pret = (f: FournisseurId) => {
    const cle = FOURNISSEUR_INFOS[f].cle
    return cle ? !!cles?.find((c) => c.nom === cle)?.source : moteurs.ollama
  }
  const offerts = FOURNISSEURS.filter((f) => f !== 'ollama' || moteurs.ollama)
  const bancDe = (c: ChoixMoteur) => (banc && memeMoteur(banc, c) ? banc : moteurs.bancs.find((b) => memeMoteur(b, c)))
  const enCours = banc?.etat === 'en_cours'
  return (
    <div className={`rg-field rg-moteurs rg-moteurs--${variante}`}>
      <div className="rg-moteurs__roles">
        {ROLES_MOTEUR.map((role) => (
          <UsageMoteur key={role} code={code} role={role} offerts={offerts} pret={pret} banc={bancDe(utilisateur.reglages.moteurs[role])} occupe={enCours} />
        ))}
      </div>
      <FieldError code={code} field="moteurs" />
      <BancsListe bancs={moteurs.bancs} enCours={banc?.etat === 'en_cours' ? banc : null} />
      <small className="rg-hint">
        {t(
          'Chaque moteur utilise votre clé : ajoutez-la dans Clés API. Le banc d’essai pose sept demandes types avec des outils simulés (rien n’est créé) ; il coûte quelques centimes. Les tarifs affichés viennent du fournisseur ou du catalogue d’OpenRouter.',
          'Chaque moteur utilise ta clé : ajoute-la dans Clés API. Le banc d’essai pose sept demandes types avec des outils simulés (rien n’est créé) ; il coûte quelques centimes. Les tarifs affichés viennent du fournisseur ou du catalogue d’OpenRouter.'
        )}
        {!moteurs.searxng && ' Recherche web hors Claude : une clé Brave Search, ou un SearXNG sur le serveur (CODE_SEARXNG_URL).'}
      </small>
    </div>
  )
}

/** Un usage : son moteur en grand, le banc en sept traits ; « changer » déplie le choix du fournisseur et du modèle. */
function UsageMoteur({ code, role, offerts, pret, banc, occupe }: { code: Code; role: RoleMoteur; offerts: FournisseurId[]; pret: (f: FournisseurId) => boolean; banc: BancResultat | undefined; occupe: boolean }) {
  const r = code.state.utilisateur!.reglages
  const choix = r.moteurs[role]
  const info = FOURNISSEUR_INFOS[choix.fournisseur]
  const liste = code.state.modeles[choix.fournisseur]
  const ollamaContexte = code.state.moteurs?.ollamaContexte
  const [draft, setDraft] = useState(choix.modele)
  useEffect(() => setDraft(choix.modele), [choix.modele])
  const connected = code.state.connection === 'connecte'
  const choisir = (c: ChoixMoteur) => {
    if (!memeMoteur(c, choix)) code.client.setReglages({ moteurs: { ...r.moteurs, [role]: c } })
  }
  const suggestion = (f: FournisseurId) => FOURNISSEUR_INFOS[f].suggestions[role === 'rapide' ? 'rapide' : 'principal']
  const ids = [...new Set([...Object.values(info.suggestions), ...(liste?.liste.map((m) => m.id) ?? [])])]
  const prix = prixTexte(liste?.liste.find((m) => m.id === choix.modele))
  const sansCle = !pret(choix.fournisseur)
  const [ouvert, setOuvert] = useState(sansCle)
  // Le champ filtre la liste ; tant qu'il montre le modèle choisi, toute la liste est visible.
  const filtre = draft.trim().toLowerCase()
  const visibles = filtre && draft !== choix.modele ? ids.filter((id) => id.toLowerCase().includes(filtre)) : ids
  const conseille = suggestion(choix.fournisseur)
  /** Entrée : le seul modèle qui reste, sinon le nom tel qu'il est tapé (un modèle que la liste ne connaît pas). */
  const valider = () => {
    const m = visibles.length === 1 && draft !== choix.modele ? visibles[0]! : draft.trim()
    if (MODELE.test(m)) choisir({ fournisseur: choix.fournisseur, modele: m })
    setDraft(MODELE.test(m) ? m : choix.modele)
  }
  // La liste se lit d'elle-même à l'ouverture, avec la clé de la personne.
  useEffect(() => {
    if (ouvert && connected && !sansCle && !liste) code.client.requestModeles(choix.fournisseur)
  }, [ouvert, connected, sansCle, liste, choix.fournisseur, code.client])
  const nom = info.nom.replace(/ \(.*\)$/, '')
  return (
    <section className={`rg-moteur${sansCle ? ' is-sans-cle' : ''}${ouvert ? ' is-ouvert' : ''}`} aria-labelledby={`rg-moteur-${role}`}>
      <header className="rg-moteur__tete">
        <h3 className="rg-moteur__role code-mono" id={`rg-moteur-${role}`}>
          {ROLE_NOMS[role].nom}
        </h3>
        <BancBadge banc={banc} />
      </header>
      <div className="rg-moteur__choix">
        <span className="rg-moteur__tuile" aria-hidden="true">
          {nom.slice(0, 1)}
        </span>
        <span className="rg-moteur__nom">
          <strong>{nom}</strong>
          <span className="code-mono">{choix.modele}</span>
        </span>
        <span className="rg-moteur__actions">
          <button type="button" className="rg-moteur__bouton" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            {ouvert ? 'Fermer' : 'Changer'}
          </button>
          <button type="button" className="rg-moteur__bouton rg-moteur__bouton--test" disabled={!connected || occupe || sansCle} onClick={() => code.client.lancerBanc(choix.fournisseur, choix.modele)}>
            Tester
          </button>
        </span>
      </div>
      <small className="rg-moteur__aide">{ROLE_NOMS[role].aide}</small>
      {banc && <BancDetail banc={banc} />}
      {sansCle ? (
        <small className="rg-error">{choix.fournisseur === 'ollama' ? 'Ollama n’est pas installé sur ce serveur.' : `Aucune clé ${info.nom} : ajoutez-la dans Clés API, ou choisissez un autre moteur.`}</small>
      ) : (
        (liste?.erreur || prix) && <small className={liste?.erreur ? 'rg-error' : 'rg-hint'}>{liste?.erreur ?? prix}</small>
      )}
      {choix.fournisseur === 'ollama' && ollamaContexte !== undefined && ollamaContexte < CONTEXTE_OLLAMA && (
        <small className="rg-error">
          Ollama ne donne au modèle que {ollamaContexte.toLocaleString('fr-FR')} tokens de mémoire de travail : les consignes de l’assistant n’y tiennent pas et Ollama en coupe le début. Relancez Ollama avec OLLAMA_CONTEXT_LENGTH=16384 (voir la documentation, « Modèle local »).
        </small>
      )}
      {ouvert && (
        <div className="rg-moteur__edition">
          <div className="rg-chips rg-moteur__fournisseurs" role="radiogroup" aria-label={`Fournisseur : ${ROLE_NOMS[role].nom}`}>
            {offerts.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={choix.fournisseur === f}
                className={`rg-chip rg-moteur__chip${pret(f) ? ' is-pret' : ''}`}
                onClick={() => choix.fournisseur !== f && choisir({ fournisseur: f, modele: suggestion(f) })}
              >
                <i aria-hidden="true" />
                {FOURNISSEUR_INFOS[f].nom.replace(/ \(.*\)$/, '')}
              </button>
            ))}
          </div>
          <form
            className="rg-moteur__modele"
            onSubmit={(e) => {
              e.preventDefault()
              valider()
            }}
          >
            <input
              className="rg-input code-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              maxLength={120}
              spellCheck={false}
              placeholder="Filtrer, ou taper le nom d’un modèle"
              aria-label={`Modèle : ${ROLE_NOMS[role].nom}`}
            />
            <button type="button" className="rg-mini" disabled={!connected || liste?.busy || sansCle} onClick={() => code.client.requestModeles(choix.fournisseur)}>
              {liste?.busy ? 'Lecture…' : liste?.liste.length ? 'Actualiser' : 'Lister les modèles'}
            </button>
          </form>
          <ul className="rg-modeles" role="listbox" aria-label={`Modèles ${nom}`}>
            {visibles.map((id) => {
              const m = liste?.liste.find((x) => x.id === id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={id === choix.modele}
                    onClick={() => {
                      setDraft(id)
                      choisir({ fournisseur: choix.fournisseur, modele: id })
                    }}
                  >
                    <span className="code-mono">{id}</span>
                    {id === conseille && <em>conseillé</em>}
                    {m?.prix && (
                      <small>
                        {dollars(m.prix.entree)} / {dollars(m.prix.sortie)}
                      </small>
                    )}
                  </button>
                </li>
              )
            })}
            {!visibles.length && <li className="rg-modeles__vide">Aucun modèle de la liste : Entrée utilise « {draft.trim()} » tel quel.</li>}
          </ul>
          {liste && liste.liste.length > 0 && <small className="rg-hint">{liste.liste.length} modèles accessibles avec votre clé · prix en dollars par million de tokens, entrée / sortie.</small>}
        </div>
      )}
    </section>
  )
}

function BancBadge({ banc }: { banc: BancResultat | undefined }) {
  const etat = banc?.etat
  return <span className={`rg-banc-badge code-mono${etat ? ` rg-banc-badge--${etat}` : ''}`}>{etat ? ETATS[etat] : 'NON TESTÉ'}</span>
}

/** Une pastille par scénario : réussi, raté, ignoré, ou pas encore posé. */
function BancDetail({ banc }: { banc: BancResultat }) {
  const rates = banc.scenarios.filter((s) => !s.ok && !s.ignore)
  return (
    <div className="rg-banc">
      <ol className="rg-banc__pistes" aria-label="Scénarios du banc d’essai">
        {Array.from({ length: Math.max(7, banc.scenarios.length) }, (_, i) => {
          const s = banc.scenarios[i]
          const etat = !s ? (banc.etat === 'en_cours' && i === banc.scenarios.length ? 'actif' : 'attente') : s.ignore ? 'ignore' : s.ok ? 'ok' : 'rate'
          return (
            <li key={i} className={`rg-banc__piste rg-banc__piste--${etat}`} title={s ? `${s.nom}${s.detail ? ` : ${s.detail}` : ''}` : undefined}>
              <span className="code-mono">{s?.nom ?? '…'}</span>
            </li>
          )
        })}
      </ol>
      {(rates.length > 0 || banc.etat !== 'en_cours') && (
        <small className="rg-hint">
          {rates.map((s) => `${s.nom} : ${s.detail}`).join(' · ')}
          {rates.length > 0 && banc.etat !== 'en_cours' ? ' — ' : ''}
          {banc.etat !== 'en_cours' && `${dollars(banc.cout)} · ${new Date(banc.le).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
        </small>
      )}
    </div>
  )
}

/** Tous les moteurs déjà passés au banc sur ce serveur (par n'importe quel compte : un modèle répond pareil pour tous). */
function BancsListe({ bancs, enCours }: { bancs: BancResultat[]; enCours: BancResultat | null }) {
  const lignes = [...bancs.filter((b) => !enCours || !memeMoteur(b, enCours)), ...(enCours ? [enCours] : [])].sort((a, b) => b.le - a.le)
  if (!lignes.length) return null
  return (
    <div className="rg-bancs">
      <div className="rg-label">
        <span>Banc d’essai sur ce serveur</span>
      </div>
      <ul>
        {lignes.map((b) => (
          <li key={`${b.fournisseur}:${b.modele}`}>
            <span className="rg-bancs__moteur">
              <strong>{FOURNISSEUR_INFOS[b.fournisseur].nom.replace(/ \(.*\)$/, '')}</strong>
              <span className="code-mono">{b.modele}</span>
            </span>
            <span className="rg-bancs__score code-mono">
              {b.scenarios.filter((s) => s.ok).length}/{b.scenarios.filter((s) => !s.ignore).length}
            </span>
            <BancBadge banc={b} />
          </li>
        ))}
      </ul>
    </div>
  )
}
