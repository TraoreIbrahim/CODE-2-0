import { useEffect, useState, type ReactNode } from 'react'
import type { Code } from '../hooks.ts'
import { registre } from './fields.tsx'

/**
 * Relier Google à l'installation : le propriétaire crée un client OAuth dans son propre projet Google Cloud
 * (gratuit), puis colle son ID et son code secret ici. Cinq étapes, chacune avec son lien direct dans la
 * console ; un point s'allume sur l'étape ouverte. Serveur hébergé : client « Application Web » et adresse de
 * retour à copier. Un membre n'a rien à faire : il attend le propriétaire.
 */

const CONSOLE = 'https://console.cloud.google.com'
const API = ['gmail.googleapis.com', 'calendar-json.googleapis.com', 'drive.googleapis.com', 'sheets.googleapis.com', 'people.googleapis.com']

export function GoogleGuide({ code }: { code: Code }) {
  const { google, utilisateur, googleIdentifiants: envoi } = code.state
  const t = registre(utilisateur)
  const [vus, setVus] = useState<Set<number>>(() => new Set())
  const [form, setForm] = useState({ id: '', secret: '' })
  const [copie, setCopie] = useState(false)
  const heberge = google.mode === 'heberge'
  // Identifiants acceptés : le formulaire se vide (le code secret ne reste pas à l'écran).
  useEffect(() => {
    if (envoi?.ok) setForm({ id: '', secret: '' })
  }, [envoi?.ok])

  if (!utilisateur?.proprietaire) {
    return (
      <p className="rg-note gg-attente">
        {t(
          'Google n’est pas encore relié à cette installation. Le propriétaire s’en occupe une fois pour tous ; il ajoutera aussi votre adresse Gmail parmi les utilisateurs autorisés. Vous pourrez ensuite connecter votre compte ici.',
          'Google n’est pas encore relié à cette installation. Le propriétaire s’en occupe une fois pour tous ; il ajoutera aussi ton adresse Gmail parmi les utilisateurs autorisés. Tu pourras ensuite connecter ton compte ici.'
        )}
      </p>
    )
  }

  const ouvert = (i: number) => setVus((s) => new Set(s).add(i))
  const copier = () => {
    if (!google.retour) return
    void navigator.clipboard?.writeText(google.retour).then(() => {
      setCopie(true)
      setTimeout(() => setCopie(false), 1800)
    })
  }
  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (envoi?.busy || !form.id.trim() || !form.secret.trim()) return
    code.client.relierGoogle(form.id.trim(), form.secret.trim())
  }

  const etapes: { titre: string; texte: string; lien?: { href: string; libelle: string }; extra?: ReactNode }[] = [
    {
      titre: 'Créer un projet',
      texte: t('Dans la console Google Cloud, un projet à vous, gratuit. Nom libre : « Assistant », par exemple.', 'Dans la console Google Cloud, un projet à toi, gratuit. Nom libre : « Assistant », par exemple.'),
      lien: { href: `${CONSOLE}/projectcreate`, libelle: 'Nouveau projet' }
    },
    {
      titre: 'Activer les cinq API',
      texte: 'Gmail, Agenda, Drive, Sheets et Contacts (People API), d’un coup : vérifiez que le bon projet est choisi en haut, puis « Activer ».',
      lien: { href: `${CONSOLE}/flows/enableapi?apiid=${API.join(',')}`, libelle: 'Activer les API' }
    },
    {
      titre: 'Présenter l’application',
      texte: t(
        'Google Auth Platform › Commencer : un nom, votre adresse, audience « Externe ». Puis Audience › Utilisateurs test : ajoutez votre adresse Gmail, et celle de chaque personne de cette installation.',
        'Google Auth Platform › Commencer : un nom, ton adresse, audience « Externe ». Puis Audience › Utilisateurs test : ajoute ton adresse Gmail, et celle de chaque personne de cette installation.'
      ),
      lien: { href: `${CONSOLE}/auth/overview`, libelle: 'Écran de consentement' }
    },
    {
      titre: 'Créer le client',
      texte: heberge
        ? 'Clients › Créer un client : type « Application Web ». Dans « URI de redirection autorisés », ajoutez l’adresse ci-dessous, telle quelle.'
        : 'Clients › Créer un client : type « Application de bureau ». Google affiche alors l’ID client et le code secret.',
      lien: { href: `${CONSOLE}/auth/clients/create`, libelle: 'Nouveau client' },
      extra:
        heberge && google.retour ? (
          <span className="gg__retour">
            <code className="code-mono">{google.retour}</code>
            <button type="button" className="rg-mini" onClick={copier}>
              {copie ? 'Copiée' : 'Copier'}
            </button>
          </span>
        ) : undefined
    }
  ]

  return (
    <section className="gg" aria-labelledby="gg-titre">
      <header className="gg__tete">
        <h3 id="gg-titre" className="gg__titre">
          Relier Google
        </h3>
        <span className="gg__duree code-mono">5 ÉTAPES · 10 MIN</span>
      </header>
      <p className="rg-note">
        {t(
          'Une seule fois pour toute l’installation. Vos mails, votre agenda et vos fichiers passent directement de Google à votre serveur : personne d’autre ne les voit.',
          'Une seule fois pour toute l’installation. Tes mails, ton agenda et tes fichiers passent directement de Google à ton serveur : personne d’autre ne les voit.'
        )}
      </p>
      <ol className="gg__piste">
        {etapes.map((e, i) => (
          <li key={e.titre} className={`gg__etape${vus.has(i) ? ' is-vue' : ''}`}>
            <span className="gg__num code-mono" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="gg__corps">
              <strong>{e.titre}</strong>
              <p>{e.texte}</p>
              {e.extra}
              {e.lien && (
                <a className="gg__lien" href={e.lien.href} target="_blank" rel="noreferrer" onClick={() => ouvert(i)}>
                  {e.lien.libelle} <span aria-hidden="true">›</span>
                </a>
              )}
            </div>
          </li>
        ))}
        <li className={`gg__etape gg__etape--fin${envoi?.ok ? ' is-vue' : ''}`}>
          <span className="gg__num code-mono" aria-hidden="true">
            05
          </span>
          <form className="gg__corps gg__form" onSubmit={submit} autoComplete="off">
            <strong>Coller les identifiants</strong>
            <label className="rg-boite-form__field">
              <span>ID client</span>
              <input
                className="rg-input"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="1234…apps.googleusercontent.com"
                autoCapitalize="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="rg-boite-form__field">
              <span>Code secret du client</span>
              <input
                className="rg-input"
                type="password"
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                placeholder="GOCSPX-…"
                autoComplete="new-password"
                required
              />
            </label>
            {envoi?.message && !envoi.busy && (
              <p className={envoi.ok ? 'rg-note' : 'rg-error'} role="alert">
                {envoi.message}
              </p>
            )}
            <div className="rg-row">
              <button type="submit" className="rg-mini gg__valider" disabled={!!envoi?.busy || !form.id.trim() || !form.secret.trim() || code.state.connection !== 'connecte'}>
                {envoi?.busy ? 'Vérification auprès de Google…' : 'Relier Google'}
              </button>
            </div>
            <small className="rg-hint">Le code secret est chiffré sur le serveur et ne s’affiche plus ensuite.</small>
          </form>
        </li>
      </ol>
    </section>
  )
}
