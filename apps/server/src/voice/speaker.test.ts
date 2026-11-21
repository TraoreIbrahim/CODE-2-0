import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// La base s'ouvre au chargement du module : un dossier jetable, jamais les vraies données.
process.env.CODE_DATA_DIR = mkdtempSync(join(tmpdir(), 'code-voix-'))
const { normalize, seuilPhrase, similarity, voiced, SpeakerTurn } = await import('./speaker.ts')
const { codeConfig } = await import('../../../../config/code.config.ts')

test('empreintes : norme 1, ressemblance = produit scalaire', () => {
  const a = normalize(Float32Array.from([3, 4]))
  assert.deepEqual([...a].map((x) => Math.round(x * 100) / 100), [0.6, 0.8])
  assert.equal(Math.round(similarity(a, a) * 1000) / 1000, 1)
  assert.equal(similarity(a, normalize(Float32Array.from([-4, 3]))), 0)
  assert.deepEqual([...normalize(new Float32Array(2))], [0, 0])
})

test('seules les tranches parlées comptent', () => {
  const frame = 320 // 20 ms à 16 kHz
  const samples = new Float32Array(frame * 5)
  samples.fill(0.25, frame, frame * 2) // parole
  samples.fill(0.001, frame * 3, frame * 4) // souffle
  samples.fill(-0.125, frame * 4, frame * 5 - 10) // parole, tranche incomplète gardée entière
  const kept = voiced(samples)
  assert.equal(kept.length, frame * 2)
  assert.equal(kept[0], 0.25)
  assert.equal(kept[frame], -0.125)
})

/** Une phrase fictive : chaque pas de 0,5 s porte une étiquette, le faux juge note la plus récente de la tranche. */
function follow(labels: string, called = false) {
  const hop = (c: string) => Buffer.alloc(16_000, c.charCodeAt(0))
  const score = (pcm: Buffer) => ({ m: 0.9, a: 0.1 } as Record<string, number>)[String.fromCharCode(pcm[pcm.length - 1]!)] ?? null
  const limits = { windowThreshold: 0.4, continueThreshold: 0.4, endMs: 1_500, endFiniMs: 1_000, endMaxMs: 3_000, giveUpMs: 2_000, calledMaxMs: 3_000 }
  const turn = new SpeakerTurn(score, limits, called)
  let kept = ''
  let end: string | null = null
  for (const c of labels) {
    const u = turn.push(hop(c))
    kept += u.release.map((b) => String.fromCharCode(b[0]!)).join('')
    end ??= u.end
    if (u.end) break
  }
  return { kept, end, started: turn.started, heard: turn.heard }
}

test('la phrase commence à votre voix et finit quand elle se tait, même si d’autres parlent', () => {
  // Deux pas d'autres voix avant vous : la tranche de départ les reprend (1,5 s), rien de plus tôt.
  assert.deepEqual(follow('aaammsmmaaaaaa'), { kept: 'aammsmma', end: 'fin', started: true, heard: true })
})

test('sans votre voix, l’écoute s’arrête', () => {
  assert.deepEqual(follow('aaaaaaa'), { kept: '', end: 'autre', started: false, heard: false })
})

test('des silences (« s », trop court pour juger) ne comptent pas comme d’autres voix au départ', () => {
  assert.deepEqual(follow('sssssssmm').started, true)
})

test('continuer est moins exigeant que commencer : le bruit ne coupe plus la phrase', () => {
  // « n » : votre voix gênée par le bruit (0,35), assez pour continuer, pas pour commencer.
  const hop = (c: string) => Buffer.alloc(16_000, c.charCodeAt(0))
  const score = (pcm: Buffer) => ({ m: 0.9, n: 0.35, a: 0.1 } as Record<string, number>)[String.fromCharCode(pcm[pcm.length - 1]!)] ?? null
  const turn = new SpeakerTurn(score, { windowThreshold: 0.4, continueThreshold: 0.33, endMs: 1_500, endFiniMs: 1_000, endMaxMs: 3_000, giveUpMs: 2_000, calledMaxMs: 3_000 })
  const ends = [...'nnmnnnnmaaa'].map((c) => turn.push(hop(c)).end)
  assert.equal(turn.started, true)
  assert.deepEqual(ends.filter(Boolean), ['fin'])
  assert.equal(ends.indexOf('fin'), 10)
})

test('appelé exprès : tout est gardé jusqu’à votre voix, puis le suivi reprend', () => {
  assert.deepEqual(follow('aammaaaaa', true), { kept: 'aamma', end: 'fin', started: true, heard: true })
})

test('appelé exprès sans votre voix reconnue : la phrase est gardée, dans une limite de durée', () => {
  assert.deepEqual(follow('aaaaaaaaa', true), { kept: 'aaaaaa', end: 'fin', started: true, heard: false })
})

test('selon le sens : finie, elle finit vite ; inachevée, elle attend ; pas encore jugée, entre les deux', () => {
  const hop = (c: string) => Buffer.alloc(16_000, c.charCodeAt(0))
  const score = (pcm: Buffer) => ({ m: 0.9, a: 0.1 } as Record<string, number>)[String.fromCharCode(pcm[pcm.length - 1]!)] ?? null
  const limits = { windowThreshold: 0.4, continueThreshold: 0.4, endMs: 1_500, endFiniMs: 1_000, endMaxMs: 3_000, giveUpMs: 2_000, calledMaxMs: 3_000 }
  const fin = (sens: boolean | null) => {
    const turn = new SpeakerTurn(score, limits, false, () => sens)
    return [...'mmssssssss'].map((c) => turn.push(hop(c)).end).indexOf('fin')
  }
  assert.equal(fin(true), 3) // 1 s de silence
  assert.equal(fin(null), 4) // 1,5 s
  assert.equal(fin(false), 7) // 3 s
})

test('à la fin, les pas proches de votre voix (plus basse, une hésitation) sont transcrits aussi', () => {
  const hop = (c: string) => Buffer.alloc(16_000, c.charCodeAt(0))
  const score = (pcm: Buffer) => ({ m: 0.9, p: 0.32, a: 0.1 } as Record<string, number>)[String.fromCharCode(pcm[pcm.length - 1]!)] ?? null
  const turn = new SpeakerTurn(score, { windowThreshold: 0.4, continueThreshold: 0.4, endMs: 1_500, endFiniMs: 1_000, endMaxMs: 3_000, giveUpMs: 2_000, calledMaxMs: 3_000 })
  let kept = ''
  for (const c of 'mmapa') kept += turn.push(hop(c)).release.map((b) => String.fromCharCode(b[0]!)).join('')
  assert.equal(kept, 'mmap')
})

test('dans la suite d’une conversation, le seuil d’une phrase est un peu plus tolérant ; sinon, celui de l’empreinte', () => {
  const { threshold, seuilRecent, trustWindowMs } = codeConfig.speaker
  assert.ok(seuilRecent < threshold)
  // Les répliques refusées à tort (0,30 à 0,34) passent ; les autres voix mesurées (0,29 au plus) restent dehors.
  assert.ok(seuilRecent <= 0.3 && seuilRecent > 0.29)
  assert.equal(seuilPhrase(5_000), seuilRecent)
  assert.equal(seuilPhrase(trustWindowMs - 1), seuilRecent)
  assert.equal(seuilPhrase(trustWindowMs), threshold)
  assert.equal(seuilPhrase(Date.now()), threshold)
})
