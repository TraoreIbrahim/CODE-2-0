import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Base de test isolée, dans un dossier jetable.
const scratch = mkdtempSync(join(tmpdir(), 'code-listes-'))
process.env.CODE_DATA_DIR = scratch
process.env.CODE_MEMORY_DIR = join(scratch, 'memory')
const { setMasterKey } = await import('../users/crypto.ts')
setMasterKey(randomBytes(32))
const { db, ensureOwner, recentLog } = await import('../db.ts')
const { getUser } = await import('../users/users.ts')
const { setActif } = await import('../users/comptes.ts')
const { autresPrenoms, trouverPersonnes } = await import('../users/personnes.ts')
const { onListesChange, getListe, elementsDe } = await import('./store.ts')
const { listeAdd, listeCheck, listeRemove, listeShare, listeDelete, listesShow } = await import('../tools/listes.ts')
const { reminderCreate } = await import('../tools/rappels.ts')
const { activeRappels } = await import('../scheduler/store.ts')
const { reminderSpeech } = await import('../scheduler/speech.ts')
import type { ToolContext } from '../tools/types.ts'
import type { UiListe, UiListes, UiRappels } from '@code/protocol'

const nouveau = (prenom: string, nom = '') => Number(db.prepare('INSERT INTO utilisateurs (prenom, nom, cree) VALUES (?, ?, ?)').run(prenom, nom, Date.now()).lastInsertRowid)
const moi = ensureOwner()
db.prepare('UPDATE utilisateurs SET prenom = ? WHERE id = ?').run('Inès', moi)
const leo = nouveau('Léo')
const sam = nouveau('Sam', 'Martin')
const parti = nouveau('Noé')
setActif(parti, false)

const confirmations: (() => Promise<void>)[] = []
const ctx = (uid: number) =>
  ({
    user: getUser(uid)!,
    log: () => {},
    announce: () => {},
    requestConfirmation: (_t: string, _s: string, run: () => Promise<void>) => void confirmations.push(run)
  }) as unknown as ToolContext

test('personnes : par prénom, sans accents ni casse ; « tous » et « moi » ; jamais un compte désactivé ni un inconnu', () => {
  assert.deepEqual(autresPrenoms(moi), ['Léo', 'Sam'])
  const r = trouverPersonnes(moi, ['leo', 'SAM MARTIN'])
  assert.ok('personnes' in r)
  assert.deepEqual(r.personnes.map((u) => u.id), [leo, sam])
  const tous = trouverPersonnes(leo, ['toute la maison'])
  assert.ok('personnes' in tous)
  assert.deepEqual(tous.personnes.map((u) => u.id), [moi, leo, sam])
  const inconnu = trouverPersonnes(moi, ['Noé'])
  assert.ok('erreur' in inconnu)
  assert.match(inconnu.erreur, /n’a pas de compte.*Léo, Sam/)
})

test('liste_ajouter : la liste est créée au premier ajout, partagée si on le dit ; jamais un élément en double', async () => {
  const vus: number[][] = []
  const stop = onListesChange((uids) => vus.push(uids))
  const r = await listeAdd.run({ liste: 'liste de courses', partage: 'tous', elements: [{ texte: 'Lait', quantite: '2' }, { texte: 'œufs' }] }, ctx(moi))
  stop()
  const v = r.view as UiListe
  assert.equal(v.nom, 'Courses')
  assert.equal(v.partage.libelle, 'Toute la maison')
  assert.equal(v.restants, 2)
  assert.match(String(r.content), /Liste « Courses » créée \(toute la maison\)/)
  // Toute la maison est prévenue (ses écrans suivent).
  assert.ok(vus.some((u) => u.includes(leo) && u.includes(sam) && u.includes(moi)))
  // Léo la trouve par « courses » et l'écrit ; « lait » ne double pas, sa quantité suit.
  const ajout = await listeAdd.run({ liste: 'courses', elements: [{ texte: 'lait', quantite: '3' }, { texte: 'Pain' }] }, ctx(leo))
  assert.match(String(ajout.content), /Ajouté : Pain\. Déjà dessus : Lait \(3\)/)
  const liste = ajout.view as UiListe
  assert.equal(liste.elements.length, 3)
  assert.equal(liste.elements.find((e) => e.texte === 'Pain')!.par!.prenom, 'Léo')
  assert.equal(liste.mienne, false)
  assert.equal(liste.auteur!.prenom, 'Inès')
})

test('liste_cocher : par le texte, chez tous ; un élément coché qu’on rajoute revient', async () => {
  assert.match(listeCheck.validate({ liste: 'courses', elements: ['beurre'] }, ctx(sam))!, /n’est pas dans la liste/)
  const r = await listeCheck.run({ liste: 'Courses', elements: ['pain', 'OEUFS'] }, ctx(sam))
  assert.match(String(r.content), /Coché : Pain, œufs\. Liste « Courses » : 1 à prendre/)
  const l = (await listesShow.run({ liste: 'courses' }, ctx(moi))).view as UiListe
  assert.deepEqual(l.elements.map((e) => [e.texte, e.coche]), [['Lait', false], ['œufs', true], ['Pain', true]])
  assert.equal(l.elements.find((e) => e.texte === 'Pain')!.cochePar!.prenom, 'Sam')
  await listeAdd.run({ liste: 'courses', elements: [{ texte: 'pain' }] }, ctx(moi))
  const id = getListe(moi, l.id)!.id
  assert.equal(elementsDe(moi, id).find((e) => e.texte === 'Pain')!.coche, false)
  // Vider ce qui est pris.
  const vide = await listeRemove.run({ liste: 'courses', coches: true }, ctx(leo))
  assert.match(String(vide.content), /Retiré de « Courses » : œufs/)
})

test('liste privée : invisible des autres ; partage et suppression réservés au créateur', async () => {
  await listeAdd.run({ liste: 'Cadeaux de Noël', elements: [{ texte: 'Livre pour Léo' }] }, ctx(moi))
  assert.match(listesShow.validate({ liste: 'cadeaux' }, ctx(leo))!, /Pas de liste « cadeaux »/)
  const listes = (await listesShow.run({}, ctx(leo))).view as UiListes
  assert.deepEqual(listes.listes.map((l) => l.nom), ['Courses'])
  // Partagée avec Sam seulement.
  assert.equal(listeShare.validate({ liste: 'cadeaux', partage: 'personnes', personnes: ['Sam'] }, ctx(moi)), null)
  const p = (await listeShare.run({ liste: 'cadeaux', partage: 'personnes', personnes: ['Sam'] }, ctx(moi))).view as UiListe
  assert.equal(p.partage.libelle, 'Avec Sam')
  assert.ok((await listesShow.run({}, ctx(sam))).view)
  assert.match(listesShow.validate({ liste: 'cadeaux' }, ctx(leo))!, /Pas de liste/)
  assert.match(listeShare.validate({ liste: 'cadeaux', partage: 'tous' }, ctx(sam))!, /Seule la personne qui a créé la liste « Cadeaux de Noël » \(Inès\)/)
  assert.match(listeDelete.validate({ liste: 'cadeaux' }, ctx(sam))!, /Seule la personne/)
  // Supprimer demande un « oui » ; ensuite, elle disparaît chez Sam aussi.
  await listeDelete.run({ liste: 'cadeaux' }, ctx(moi))
  assert.ok(getListe(sam, p.id))
  await confirmations.pop()!()
  assert.equal(getListe(sam, p.id), null)
})

test('rappel pour un autre : dans son compte, avec son auteur ; un prénom inconnu est refusé', async () => {
  assert.match(reminderCreate.validate({ texte: 'Sortir le chien', dans_minutes: 30, pour: ['Noé'] }, ctx(moi))!, /« Noé » n’a pas de compte/)
  const r = await reminderCreate.run({ texte: 'Sortir le chien', dans_minutes: 30, annonce: 'vous devez sortir le chien', pour: ['leo'] }, ctx(moi))
  assert.match(String(r.content), /Rappel enregistré pour Léo : « Sortir le chien »/)
  assert.deepEqual(activeRappels(moi), [])
  const [chezLeo] = activeRappels(leo)
  assert.equal(chezLeo!.de, 'Inès')
  // L'annonce, écrite pour celui qui parle, n'est pas reprise chez Léo.
  assert.equal(chezLeo!.annonce, null)
  assert.match(recentLog(leo, 5)[0]!.summary, /Rappel donné par Inès : « Sortir le chien »/)
  assert.equal((r.view as UiRappels).groupes[0]!.label, 'Pour Léo')
  assert.equal(reminderSpeech([chezLeo!], 'Léo', 10, true, true), 'Bonjour Léo, petit rappel de la part d’Inès : sortir le chien.')
})

test('rappel pour toute la maison : chacun le sien, celui qui parle compris', async () => {
  await reminderCreate.run({ texte: 'Anniversaire de mamie', le: '2099-06-14T10:00', annonce: 'c’est l’anniversaire de mamie', pour: ['tous'] }, ctx(sam))
  assert.equal(activeRappels(sam).find((r) => r.texte === 'Anniversaire de mamie')!.de, null)
  assert.equal(activeRappels(sam).find((r) => r.texte === 'Anniversaire de mamie')!.annonce, 'c’est l’anniversaire de mamie')
  for (const uid of [moi, leo]) assert.equal(activeRappels(uid).find((r) => r.texte === 'Anniversaire de mamie')!.de, 'Sam')
  assert.equal(activeRappels(parti).length, 0)
  assert.equal(reminderSpeech([{ texte: 'Payer la cantine', annonce: null, de: 'Léo' }], 'Sam', 20, false), 'Sam, petit rappel de la part de Léo : payer la cantine.')
})
