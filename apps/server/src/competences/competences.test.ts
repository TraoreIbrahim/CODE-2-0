import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import type { ToolContext } from '../tools/types.ts'
import { competenceCreer, competenceLire, competenceSupprimer, competenceTools, competencesLister, etapes } from '../tools/competences.ts'
import { competencesConsigne } from '../brain/prompt.ts'
import { dossierCompetences, getCompetence, lireTexte, listCompetences, modeles, onCompetencesChange, removeCompetence, saveCompetence, slug, versTexte } from './store.ts'

const ctx = (uid: number, o: Partial<ToolContext> = {}) => {
  const attente: (() => Promise<void>)[] = []
  const cartes: { titre: string; resume: string }[] = []
  const dit: string[] = []
  const c = {
    user: { id: uid },
    requestConfirmation: (titre: string, resume: string, f: () => Promise<void>) => void (cartes.push({ titre, resume }), attente.push(f)),
    announce: (t: string) => void dit.push(t),
    log: () => {},
    ...o
  } as unknown as ToolContext
  return { c, attente, cartes, dit }
}

describe('compétences : le fichier texte', () => {
  test('en-tête nom et description, puis la méthode', () => {
    const r = lireTexte('---\nnom: Compte rendu\ndescription: "Quand on me demande un compte rendu : réunion, appel."\n---\n\n1. Décisions\n2. Actions\n')
    assert.deepEqual(r, { nom: 'Compte rendu', description: 'Quand on me demande un compte rendu : réunion, appel.', corps: '1. Décisions\n2. Actions' })
  })

  test('format SKILL.md de Claude (name, description sur plusieurs lignes)', () => {
    const r = lireTexte('---\nname: release-notes\ndescription: >\n  Writes release notes\n  from merged PRs.\nlicense: MIT\n---\n# Release notes\n\nSteps…')
    assert.ok(!('erreur' in r))
    assert.equal(r.nom, 'release-notes')
    assert.equal(r.description, 'Writes release notes from merged PRs.')
    assert.match(r.corps, /^# Release notes/)
  })

  test('sans en-tête : le titre donne le nom, le premier paragraphe la description', () => {
    const r = lireTexte('# Préparer un devis\n\nQuand un client demande un devis.\n\n- Reprendre les tarifs du tableur.', 'devis.md')
    assert.deepEqual(r, { nom: 'Préparer un devis', description: 'Quand un client demande un devis.', corps: 'Quand un client demande un devis.\n\n- Reprendre les tarifs du tableur.' })
    const sansTitre = lireTexte('Toujours vouvoyer les clients.', 'ton-avec-les-clients.md')
    assert.ok(!('erreur' in sansTitre))
    assert.equal(sansTitre.nom, 'ton avec les clients')
  })

  test('refusé : sans méthode, description trop longue, méthode trop longue', () => {
    assert.ok('erreur' in lireTexte('---\nnom: Vide\ndescription: Jamais.\n---\n'))
    assert.ok('erreur' in lireTexte(`---\nnom: Longue\ndescription: ${'x'.repeat(400)}\n---\nMéthode.`))
    assert.ok('erreur' in lireTexte(`---\nnom: Énorme\ndescription: Parfois.\n---\n${'y'.repeat(13_000)}`))
  })

  test('aller-retour : ce qui est écrit se relit à l’identique, même avec « : » et guillemets', () => {
    const c = { nom: 'Relance : facture', description: '"Urgent" — quand un client tarde à payer.', corps: '# Étapes\n\n1. Retrouver le fil.' }
    assert.deepEqual(lireTexte(versTexte(c)), c)
  })

  test('slug : sans accents ni ponctuation', () => {
    assert.equal(slug('Compte rendu de réunion !'), 'compte-rendu-de-reunion')
    assert.equal(slug('***'), 'competence')
  })

  test('les modèles livrés se lisent tous', () => {
    const m = modeles()
    assert.ok(m.length >= 3)
    assert.ok(m.every((c) => c.nom && c.description && c.corps))
  })
})

describe('compétences : par compte', () => {
  test('enregistrer, renommer, refuser un doublon, supprimer ; chacun les siennes', () => {
    const vus: number[] = []
    const stop = onCompetencesChange((uid) => vus.push(uid))
    const a = saveCompetence(9101, { nom: 'Compte rendu', description: 'Quand une réunion se termine.', corps: 'Décisions, actions.' })
    assert.ok(!('erreur' in a))
    assert.equal(a.id, 'compte-rendu')
    assert.ok('erreur' in saveCompetence(9101, { nom: 'Compte rendu', description: 'Autre.', corps: 'Autre.' }))
    const b = saveCompetence(9101, { nom: 'Compte rendu de réunion', description: 'Quand une réunion se termine.', corps: 'Décisions, actions, points ouverts.' }, { id: 'compte-rendu' })
    assert.ok(!('erreur' in b))
    assert.deepEqual(listCompetences(9101).map((c) => c.id), ['compte-rendu-de-reunion'])
    assert.equal(listCompetences(9102).length, 0)
    assert.equal(getCompetence(9101, 'compte rendu de réunion')?.id, 'compte-rendu-de-reunion')
    assert.ok(removeCompetence(9101, 'compte-rendu-de-reunion'))
    assert.equal(removeCompetence(9101, '../9102/x'), false)
    assert.deepEqual(vus, [9101, 9101, 9101])
    stop()
  })

  test('un fichier déposé à la main (ou un dossier SKILL.md) est lu ; un fichier cassé est ignoré', () => {
    const dir = dossierCompetences(9103)
    writeFileSync(join(dir, 'ton.md'), '# Ton\n\nAvec les clients.\n\nToujours vouvoyer.')
    writeFileSync(join(dir, 'casse.md'), '---\nnom: Cassé\n---\n')
    mkdirSync(join(dir, 'notes-de-version'), { recursive: true })
    writeFileSync(join(dir, 'notes-de-version', 'SKILL.md'), '---\nname: Notes de version\ndescription: Quand on publie une version.\n---\nLister les changements.')
    assert.deepEqual(listCompetences(9103).map((c) => c.nom), ['Notes de version', 'Ton'])
    assert.ok(removeCompetence(9103, 'notes-de-version'))
    assert.deepEqual(listCompetences(9103).map((c) => c.nom), ['Ton'])
  })
})

describe('compétences : l’assistant', () => {
  test('la liste dans les consignes, la méthode à la demande', async () => {
    assert.match(competencesConsigne(9201, 'Léa'), /competence_creer/)
    assert.deepEqual(competenceTools(9201).map((t) => t.name), ['competences_lister', 'competence_creer', 'competence_supprimer'])
    saveCompetence(9201, { nom: 'Relance de facture', description: 'Quand un client tarde à payer.', corps: 'Retrouver le fil, puis gmail_brouillon.' })
    assert.match(competencesConsigne(9201, 'Léa'), /- Relance de facture : Quand un client tarde à payer\./)
    assert.deepEqual(competenceTools(9201).map((t) => t.name), ['competence_lire', 'competences_lister', 'competence_creer', 'competence_supprimer'])
    const r = await competenceLire.run({ nom: 'relance de facture' }, ctx(9201).c)
    assert.match(String(r.content), /gmail_brouillon/)
    assert.match(String(r.content), /pas ce qui est permis/)
    // À l'écran : la méthode telle qu'elle est écrite, marquée « suivie » quand l'assistant la lit pour une demande.
    assert.deepEqual([r.view?.kind, (r.view as { suivie?: boolean }).suivie, (r.view as { corps: string }).corps], ['competence', true, 'Retrouver le fil, puis gmail_brouillon.'])
    const consultee = await competenceLire.run({ nom: 'relance de facture', consulter: true }, ctx(9201).c)
    assert.equal((consultee.view as { suivie?: boolean }).suivie, undefined)
    const liste = await competencesLister.run({}, ctx(9201).c)
    assert.deepEqual((liste.view as { competences: { nom: string }[] }).competences.map((c) => c.nom), ['Relance de facture'])
    assert.equal(etapes('1. Lire\n2. Ranger\n   - détail\n3. Dire'), 3)
    assert.equal(etapes('- Vouvoyer\n- Rester bref'), 2)
    const absente = await competenceLire.run({ nom: 'piscine' }, ctx(9201).c)
    assert.equal(absente.isError, true)
    assert.match(String(absente.content), /Relance de facture/)
  })

  test('apprendre : rien avant le « oui », puis le fichier ; même nom : mise à jour', async () => {
    const { c, attente, cartes, dit } = ctx(9202)
    const r = await competenceCreer.run({ nom: 'Préparer un devis', description: 'Quand un client demande un devis.', methode: 'Reprendre les tarifs.' }, c)
    assert.match(String(r.content), /En attente de validation/)
    assert.equal(listCompetences(9202).length, 0)
    assert.equal(cartes[0]!.titre, 'Apprendre « Préparer un devis »')
    await attente[0]!()
    assert.equal(dit[0], 'C’est appris.')
    assert.match(readFileSync(join(dossierCompetences(9202), 'preparer-un-devis.md'), 'utf8'), /^---\nnom: Préparer un devis\n/)
    await competenceCreer.run({ nom: 'préparer un devis', description: 'Quand un client demande un devis.', methode: 'Reprendre les tarifs, TVA comprise.' }, c)
    assert.equal(cartes[1]!.titre, 'Mettre à jour « Préparer un devis »')
    await attente[1]!()
    assert.equal(listCompetences(9202).length, 1)
    assert.match(listCompetences(9202)[0]!.corps, /TVA/)
    assert.match(competenceCreer.validate({ nom: 'x', description: 'y', methode: 'z'.repeat(13_000) }, c) ?? '', /découpez/)
  })

  test('oublier : après le « oui » seulement ; refusé dans une tâche planifiée', async () => {
    saveCompetence(9203, { nom: 'Ton', description: 'Avec les clients.', corps: 'Vouvoyer.' })
    const { c, attente } = ctx(9203)
    await competenceSupprimer.run({ nom: 'ton' }, c)
    assert.equal(listCompetences(9203).length, 1)
    await attente[0]!()
    assert.equal(listCompetences(9203).length, 0)
    const { unattendedAllowed } = await import('../tools/index.ts')
    assert.equal(unattendedAllowed(competenceCreer), false)
    assert.equal(unattendedAllowed(competenceLire), true)
  })
})
