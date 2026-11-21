import { useEffect } from 'react'
import { SYNTHESES, SYNTHESE_INFOS, TRANSCRIPTIONS, TRANSCRIPTION_INFOS, syntheseEffective, transcriptionEffective, type CleApi } from '@code/protocol'
import type { Code } from '../hooks.ts'
import { nomDe } from './comptes.tsx'
import { FieldError, registre } from './fields.tsx'

/**
 * Réglages › Voix : qui transcrit ce que vous dites, qui parle pour l'assistant, chacun avec vos clés.
 * « Automatique » prend le premier disponible ; un service sans sa clé reste choisi, mais l'automatique
 * le remplace en attendant (`transcriptionEffective`, `syntheseEffective`, comme sur le serveur).
 * `resume` (assistant de premier lancement) : une phrase, sans choix.
 */

type Infos<T extends string> = Record<T, { nom: string; cle: CleApi; aide: string }>

export function VoixServicesField({ code, variante = 'complet' }: { code: Code; variante?: 'complet' | 'resume' }) {
  const { cles, connection, utilisateur, synthese } = code.state
  const connected = connection === 'connecte'
  useEffect(() => {
    if (connected) code.client.requestCles()
  }, [connected, code.client])
  if (!utilisateur || !cles) return null
  const r = utilisateur.reglages
  const t = registre(utilisateur)
  const nom = nomDe(code)
  const aCle = (c: CleApi) => !!cles.find((k) => k.nom === c)?.source
  const ecoute = transcriptionEffective(r.transcription, aCle)
  const parole = syntheseEffective(r.synthese, aCle)
  const ecouteNom = ecoute.finale && (ecoute.direct && ecoute.finale !== 'deepgram' ? `${TRANSCRIPTION_INFOS[ecoute.finale].nom}, avec Deepgram pour le texte en direct` : TRANSCRIPTION_INFOS[ecoute.finale].nom)
  const paroleNom = parole.synthese && SYNTHESE_INFOS[parole.synthese].nom

  if (variante === 'resume') {
    return (
      <p className="rg-note rg-services__resume">
        {ecouteNom
          ? t(`Je vous écoute avec ${ecouteNom}`, `Je t’écoute avec ${ecouteNom}`)
          : t('Aucune clé de transcription : ajoutez-en une à l’étape Clés API pour me parler', 'Aucune clé de transcription : ajoute-en une à l’étape Clés API pour me parler')}
        {paroleNom ? ` ; je parle avec ${paroleNom}.` : ' ; sans clé de voix, je réponds par écrit.'} {t('Vous pourrez changer de service dans Réglages › Voix.', 'Tu pourras changer de service dans Réglages › Voix.')}
      </p>
    )
  }

  return (
    <div className="rg-field rg-services">
      <Service
        titre={t('Ce que vous dites', 'Ce que tu dis')}
        role="transcription"
        ids={TRANSCRIPTIONS}
        infos={TRANSCRIPTION_INFOS}
        choix={r.transcription}
        aCle={aCle}
        actuel={ecouteNom}
        repli={ecoute.repli}
        t={t}
        onChoix={(v) => code.client.setReglages({ transcription: v })}
      />
      <Service
        titre={`Ce que dit ${nom}`}
        role="synthèse"
        ids={SYNTHESES}
        infos={SYNTHESE_INFOS}
        choix={r.synthese}
        aCle={aCle}
        actuel={paroleNom}
        repli={parole.repli}
        t={t}
        onChoix={(v) => {
          code.client.setReglages({ synthese: v })
          // Entendre tout de suite ce que donne le service : la même voix, à la même vitesse.
          if (synthese) void code.voice.preview(r.voix, r.vitesseVoix)
        }}
      />
      <FieldError code={code} field="transcription" />
      <FieldError code={code} field="synthese" />
      <small className="rg-hint">
        {t(
          'Chaque service utilise votre clé : ajoutez-la dans Clés API. La voix choisie plus haut garde son caractère d’un service à l’autre (voix la plus proche chez chacun).',
          'Chaque service utilise ta clé : ajoute-la dans Clés API. La voix choisie plus haut garde son caractère d’un service à l’autre (voix la plus proche chez chacun).'
        )}
      </small>
    </div>
  )
}

function Service<T extends string>(p: {
  titre: string
  role: string
  ids: readonly T[]
  infos: Infos<T>
  choix: T | 'auto'
  aCle: (c: CleApi) => boolean
  actuel: string | null
  repli: boolean
  t: (vous: string, tu: string) => string
  onChoix: (v: T | 'auto') => void
}) {
  const { infos, choix, t } = p
  const aide = choix === 'auto' ? t('Le premier disponible avec vos clés, du plus juste au plus rapide.', 'Le premier disponible avec tes clés, du plus juste au plus rapide.') : infos[choix].aide
  const etat = !p.actuel ? t('Aucune clé pour ce service : ajoutez-en une dans Clés API.', 'Aucune clé pour ce service : ajoute-en une dans Clés API.') : p.repli ? `Clé ${infos[choix as T].nom} manquante : en attendant, ${p.actuel}.` : `En service : ${p.actuel}.`
  return (
    <section className={`rg-service${!p.actuel || p.repli ? ' is-sans-cle' : ''}`} aria-label={p.titre}>
      <h3 className="rg-service__titre">{p.titre}</h3>
      <div className="rg-chips" role="radiogroup" aria-label={`Service de ${p.role}`}>
        <button type="button" role="radio" aria-checked={choix === 'auto'} className="rg-chip rg-service__chip is-pret" onClick={() => choix !== 'auto' && p.onChoix('auto')}>
          <i aria-hidden="true" />
          Automatique
        </button>
        {p.ids.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={choix === id}
            className={`rg-chip rg-service__chip${p.aCle(infos[id].cle) ? ' is-pret' : ''}`}
            aria-label={p.aCle(infos[id].cle) ? infos[id].nom : `${infos[id].nom} (clé à ajouter)`}
            onClick={() => choix !== id && p.onChoix(id)}
          >
            <i aria-hidden="true" />
            {infos[id].nom}
          </button>
        ))}
      </div>
      <p className="rg-service__etat" role="status">
        {etat}
      </p>
      <small className="rg-hint">{aide}</small>
    </section>
  )
}
