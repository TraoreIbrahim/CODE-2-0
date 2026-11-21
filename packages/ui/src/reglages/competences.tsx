import { useEffect, useRef, useState } from 'react'
import type { CompetenceInfo } from '@code/protocol'
import type { Code } from '../hooks.ts'

/**
 * Les compétences : des méthodes en texte simple, une par fichier. L'assistant ne lit que leur nom et quand
 * s'en servir ; la méthode, seulement quand une demande y correspond. On les écrit ici, on importe un fichier
 * (.md, .txt, ou le SKILL.md d'une compétence de Claude), on part d'un modèle, ou on les dicte (« apprends à… »).
 */

const MAX_CORPS = 12_000
const MAX_FICHIER = 30_000

type Brouillon = { id?: string; nom: string; description: string; corps: string }

const date = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

function Glyphe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5" />
    </svg>
  )
}

export function CompetencesField({ code, nom }: { code: Code; nom: string }) {
  const { competences, modelesCompetences: modeles, competenceAction: action, connection } = code.state
  const [edition, setEdition] = useState<Brouillon | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [ouverte, setOuverte] = useState<string | null>(null)
  const [erreurFichier, setErreurFichier] = useState<string | null>(null)
  const fichier = useRef<HTMLInputElement>(null)
  const premierChamp = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (connection === 'connecte' && competences === null) code.client.requestCompetences()
  }, [connection, competences === null])
  // Enregistrée : l'éditeur se referme sur la compétence, qui s'ouvre pour la relire.
  useEffect(() => {
    if (action?.ok) {
      setEdition(null)
      if (action.id) setOuverte(action.id)
    }
  }, [action?.ok, action?.id])
  useEffect(() => {
    if (edition) premierChamp.current?.focus()
  }, [edition === null])

  const editer = (b: Brouillon) => {
    code.client.oublierActionCompetence()
    setErreurFichier(null)
    setEdition(b)
  }
  const importer = async (f: File | undefined) => {
    if (!f) return
    code.client.oublierActionCompetence()
    if (f.size > MAX_FICHIER) return setErreurFichier(`« ${f.name} » est trop long : ${MAX_CORPS.toLocaleString('fr-FR')} caractères de méthode au plus.`)
    setErreurFichier(null)
    code.client.importerCompetence(await f.text(), f.name)
  }

  const liste = competences ?? []
  const ids = new Set(liste.map((c) => c.id))
  const aProposer = modeles.filter((m) => !ids.has(m.id))
  const busy = !!action?.busy
  const echec = action && !action.busy && !action.ok ? action.message : null
  const edite = (id?: string) => edition && edition.id === id

  const formulaire = edition && (
    <form
      className="rg-boite-form rg-comp__form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) code.client.enregistrerCompetence(edition)
      }}
    >
      <label className="rg-boite-form__field">
        <span>Nom</span>
        <input ref={premierChamp} className="rg-input" value={edition.nom} maxLength={60} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} placeholder="Compte rendu de réunion" />
      </label>
      <label className="rg-boite-form__field">
        <span>Quand s’en servir</span>
        <textarea
          className="rg-input rg-textarea rg-textarea--court"
          value={edition.description}
          maxLength={300}
          rows={2}
          onChange={(e) => setEdition({ ...edition, description: e.target.value.replace(/\n/g, ' ') })}
          placeholder="Quand je demande le compte rendu d’une réunion ou d’un appel."
        />
      </label>
      <label className="rg-boite-form__field">
        <span>
          La méthode <em className="rg-comp__compte">{edition.corps.length.toLocaleString('fr-FR')} / {MAX_CORPS.toLocaleString('fr-FR')}</em>
        </span>
        <textarea
          className="rg-input rg-textarea"
          value={edition.corps}
          maxLength={MAX_CORPS}
          rows={10}
          spellCheck
          onChange={(e) => setEdition({ ...edition, corps: e.target.value })}
          placeholder={'1. Les décisions, une ligne chacune.\n2. Qui fait quoi, et pour quand.\n3. Ce qui reste à trancher.'}
        />
      </label>
      <p className="rg-hint">En texte simple ou en Markdown : les étapes, le format attendu, ce qu’il faut éviter. Une méthode ne donne aucun droit : envoyer, supprimer ou modifier attend toujours votre « oui ».</p>
      {echec && (
        <p className="rg-error" role="alert">
          {echec}
        </p>
      )}
      <span className="rg-row">
        <button type="submit" className="rg-mini rg-mini--on" disabled={busy || !edition.nom.trim() || !edition.description.trim() || !edition.corps.trim()}>
          {busy ? 'Enregistrement…' : edition.id ? 'Enregistrer' : 'Apprendre'}
        </button>
        <button type="button" className="rg-mini" onClick={() => setEdition(null)}>
          Annuler
        </button>
      </span>
    </form>
  )

  return (
    <div className="rg-field rg-connect rg-comp">
      {competences === null && <p className="rg-note">Chargement des compétences…</p>}
      {competences !== null && liste.length === 0 && !edition && (
        <p className="rg-note rg-comp__vide">
          Aucune compétence pour l’instant. Écrivez-en une, partez d’un modèle, ou dites à {nom} : « apprends à préparer mes comptes rendus : … ».
        </p>
      )}
      {liste.map((c: CompetenceInfo) =>
        edite(c.id) ? (
          <div key={c.id}>{formulaire}</div>
        ) : (
          <div key={c.id} className={`rg-connect__item rg-comp__item${ouverte === c.id ? ' is-open' : ''}`}>
            <span className="rg-connect__mark is-on" aria-hidden="true">
              <Glyphe />
            </span>
            <span className="rg-connect__body">
              <button type="button" className="rg-comp__titre" aria-expanded={ouverte === c.id} onClick={() => setOuverte(ouverte === c.id ? null : c.id)}>
                <strong>{c.nom}</strong>
              </button>
              <small>{c.description}</small>
              {ouverte === c.id && (
                <>
                  <pre className="rg-comp__corps">{c.corps}</pre>
                  <small className="code-mono rg-comp__meta">{`${c.id}.md · ${date(c.modifieLe)}`.toUpperCase()}</small>
                </>
              )}
            </span>
            {confirm === c.id ? (
              <span className="rg-row">
                <button type="button" className="rg-mini rg-mini--warn" onClick={() => (code.client.supprimerCompetence(c.id), setConfirm(null))}>
                  Oublier
                </button>
                <button type="button" className="rg-mini" onClick={() => setConfirm(null)}>
                  Garder
                </button>
              </span>
            ) : (
              <span className="rg-row">
                <button type="button" className="rg-mini" onClick={() => editer({ id: c.id, nom: c.nom, description: c.description, corps: c.corps })} aria-label={`Modifier ${c.nom}`}>
                  Modifier
                </button>
                <button type="button" className="rg-mini" onClick={() => setConfirm(c.id)} aria-label={`Oublier ${c.nom}`}>
                  Oublier
                </button>
              </span>
            )}
          </div>
        )
      )}
      {edition && !edition.id && formulaire}
      {!edition && (
        <div className="rg-comp__ajout">
          <span className="rg-row">
            <button type="button" className="rg-mini" onClick={() => editer({ nom: '', description: '', corps: '' })}>
              Nouvelle compétence
            </button>
            <button type="button" className="rg-mini" disabled={busy} onClick={() => fichier.current?.click()}>
              {busy ? 'Import…' : 'Importer un fichier'}
            </button>
            <input
              ref={fichier}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              hidden
              onChange={(e) => {
                void importer(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </span>
          {(erreurFichier || echec) && (
            <p className="rg-error" role="alert">
              {erreurFichier ?? echec}
            </p>
          )}
          {aProposer.length > 0 && (
            <>
              <p className="rg-label">
                <span>Modèles</span>
              </p>
              <ul className="rg-comp__modeles">
                {aProposer.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="rg-comp__modele" onClick={() => editer({ nom: m.nom, description: m.description, corps: m.corps })}>
                      <strong>{m.nom}</strong>
                      <small>{m.description}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
