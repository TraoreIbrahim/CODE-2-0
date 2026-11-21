import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PROFIL_DETAILS } from '@code/protocol'

// Base de test isolée, dans un dossier jetable.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-prompt-'))
const { BRIEFING_PROMPT, TASK_MODE, contextLine, nomAssistant, systemPrompt } = await import('./prompt.ts')
const { reglagesOf } = await import('../users/users.ts')
const { ensureOwner, db } = await import('../db.ts')

const owner = ensureOwner()
const other = Number(db.prepare('INSERT INTO utilisateurs (prenom, nom, cree) VALUES (?, ?, ?)').run('Léa', 'Bernard', Date.now()).lastInsertRowid)

const user = (id: number, extra: object = {}) => ({
  id,
  prenom: 'Léa',
  nom: 'Bernard',
  email: null,
  telephone: null,
  photo: null,
  fonction: 'Assistante de direction',
  departement: null,
  reglages: reglagesOf({}),
  proprietaire: false,
  configure: true,
  identifiant: null,
  actif: true,
  ...extra
})

test('prompt : chacun appelle son assistant comme il l’a nommé', () => {
  const p = systemPrompt({ user: user(other, { reglages: reglagesOf({ nomAssistant: 'Aya' }) }), fichiers: false })
  assert.match(p, /^Tu es Aya, l'assistant vocal personnel de Bernard/)
  assert.equal(nomAssistant(user(other, { reglages: reglagesOf({ nomAssistant: ' ' }) })), nomAssistant(), 'vide : le nom de l’installation')
})

test('prompt : le profil oriente le ton, l’usage général n’ajoute rien', () => {
  const dev = systemPrompt({ user: user(other, { reglages: reglagesOf({ profil: 'developpeur' }) }), fichiers: false })
  assert.match(dev, /Bernard développe des logiciels/)
  const general = systemPrompt({ user: user(other), fichiers: false })
  assert.ok(!/développe des logiciels|secrétariat|administration|la maison et la famille/.test(general.split('\n')[1] ?? ''))
})

test('prompt : le nom de l’assistant, l’appellation, le registre et la ville de chacun', () => {
  const p = systemPrompt({ user: user(other, { reglages: reglagesOf({ tutoiement: true, ville: 'Nantes' }) }), fichiers: false })
  assert.match(p, new RegExp(`^Tu es ${nomAssistant()}, l'assistant vocal personnel de Bernard, Assistante de direction à Nantes`))
  assert.match(p, /en tutoyant Bernard/)
  assert.ok(!p.includes('fichiers_afficher'), 'pas d’outils de fichiers sans app de bureau reliée')
  assert.match(p, /pas accès aux fichiers de son ordinateur/)
})

test('prompt : sans fonction ni accès particulier, rien d’inventé', () => {
  const p = systemPrompt({ user: user(owner, { prenom: '', nom: 'Martin', fonction: null, proprietaire: true, reglages: reglagesOf({ ville: 'Lyon' }) }), fichiers: true })
  assert.match(p, /personnel de Martin à Lyon\./)
  assert.match(p, /en vouvoyant Martin/)
  assert.match(p, /fichiers_afficher/)
  assert.doesNotMatch(p, /Autres boîtes mail reliées|Connecteurs reliés/)
})

test('prompt : le web est annoncé comme disponible ; une vue ne s’affiche que par un appel d’outil', () => {
  const p = systemPrompt({ user: user(owner), fichiers: true })
  assert.match(p, /Web \(web_search, web_fetch\)/)
  assert.match(p, /appelle-le de nouveau, même si la même question vient d'être posée/)
  assert.match(p, /toujours l'outil meteo, jamais le web/)
  assert.match(p, /Une INFORMATION .* n'affiche rien/)
  assert.match(p, /Une RECHERCHE demandée .* web_resultats_afficher/)
})

test('prompt : un message proposé passe par l’outil qui l’affiche avec sa validation, jamais dans la réponse', () => {
  const p = systemPrompt({ user: user(owner), fichiers: true, boites: ['Pro <lea@exemple.fr>'], connecteurs: ['GitHub'] })
  assert.match(p, /appelle tout de suite l'outil qui l'affiche \(mail_envoyer/)
  assert.match(p, /N'écris jamais le message proposé dans ta réponse/)
  assert.match(p, /Autres boîtes mail reliées \(IMAP\), en plus de Gmail : Pro <lea@exemple\.fr>/)
  assert.match(p, /Connecteurs reliés : GitHub/)
  assert.match(p, /projet_etat d'abord/)
})

test('messages automatiques : au nom de la personne, à son heure', () => {
  assert.match(TASK_MODE('Bernard'), /Bernard n'est pas là/)
  assert.match(BRIEFING_PROMPT('Bernard'), /pas un message de Bernard/)
  // Le briefing suit le profil : la météo d'abord pour le foyer, l'état des projets pour un développeur.
  const foyer = BRIEFING_PROMPT('Bernard', PROFIL_DETAILS.foyer.briefing)
  assert.match(foyer, /dans cet ordre :\n- meteo/)
  assert.doesNotMatch(foyer, /gmail_importants|projet_etat/)
  assert.match(BRIEFING_PROMPT('Bernard', PROFIL_DETAILS.developpeur.briefing), /projet_etat/)
  const line = contextLine(user(other, { reglages: reglagesOf({ fuseau: 'Europe/Paris', ville: 'Paris' }) }), new Date('2026-10-30T12:00:00Z'))
  assert.match(line, /13:00, Paris\.\]$/)
})

test('réglages enregistrés avant les cartes (ou avant une nouvelle carte) : complétés à la lecture', () => {
  assert.deepEqual(
    reglagesOf('{"theme":"ambre"}').widgets.map((w) => w.id),
    ['meteo', 'aujourdhui', 'rappels', 'mails', 'taches', 'echeances']
  )
  const own = reglagesOf({ widgets: [{ id: 'taches', colonne: 'gauche', visible: false }] }).widgets
  assert.deepEqual(own[0], { id: 'taches', colonne: 'gauche', visible: false })
  assert.equal(own.length, 6)
})
