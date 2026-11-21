import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MIC_SAMPLE_RATE } from '@code/protocol'
import { Decoupeur, Reechantillonneur, estAudio, wavDe, type Morceau } from './reunion-audio.ts'

const R = MIC_SAMPLE_RATE
/** `s` secondes de voix (un ton fort) ou de silence. */
const voix = (s: number) => Float32Array.from({ length: s * R }, (_, i) => 0.2 * Math.sin(i / 5))
const silence = (s: number) => new Float32Array(s * R)

function decouper(cible: number, max: number, ...blocs: Float32Array[]): Morceau[] {
  const out: Morceau[] = []
  const d = new Decoupeur(cible, max, (m) => out.push(m))
  // Par paquets de 4 096 échantillons, comme le micro.
  for (const b of blocs) for (let o = 0; o < b.length; o += 4096) d.ajouter(b.subarray(o, o + 4096))
  d.finir()
  return out
}

test('découpe à la première pause après la durée cible, sans perdre un échantillon', () => {
  const m = decouper(10, 15, voix(11), silence(1), voix(6))
  assert.equal(m.length, 2)
  assert.deepEqual(m.map((x) => x.rang), [0, 1])
  // La coupe tombe dans la seconde de silence (300 ms de calme après la cible).
  assert.ok(m[0]!.dureeS > 11 && m[0]!.dureeS < 12, `coupe à ${m[0]!.dureeS}`)
  assert.equal(m[1]!.debutS, m[0]!.dureeS)
  assert.equal(m[0]!.pcm.length + m[1]!.pcm.length, 18 * R)
})

test('sans pause, coupe d’office à la durée la plus longue', () => {
  const m = decouper(10, 15, voix(40))
  assert.deepEqual(m.map((x) => Math.round(x.dureeS)), [15, 15, 10])
  assert.deepEqual(m.map((x) => Math.round(x.debutS)), [0, 15, 30])
})

test('un morceau entièrement silencieux n’est pas envoyé ; les instants suivants restent justes', () => {
  // 0–15 : voix ; 15–25 : silence complet (jeté) ; 25–35 : cinq secondes de silence puis la voix.
  const m = decouper(10, 15, voix(15), silence(15), voix(5))
  assert.deepEqual(m.map((x) => x.rang), [0, 1])
  assert.deepEqual(m.map((x) => Math.round(x.debutS)), [0, 25])
  assert.equal(Math.round(m[1]!.dureeS), 10)
})

test('une fin de moins d’une demi-seconde est jetée', () => {
  assert.equal(decouper(10, 15, voix(0.25)).length, 0)
  assert.equal(decouper(10, 15, voix(1)).length, 1)
})

test('48 kHz et 44,1 kHz ramenés à 16 kHz, par paquets', () => {
  for (const f of [48_000, 44_100, 16_000]) {
    const r = new Reechantillonneur(f)
    let n = 0
    const entree = new Float32Array(f).fill(0.5)
    for (let o = 0; o < entree.length; o += 4096) n += r.passer(entree.subarray(o, o + 4096)).length
    assert.ok(Math.abs(n - R) <= 1, `${f} Hz → ${n} échantillons`)
  }
  const sortie = new Reechantillonneur(48_000).passer(new Float32Array(48).fill(0.5))
  assert.ok(sortie.every((v) => Math.abs(v - 0.5) < 1e-6))
})

test('WAV : en-tête 16 kHz mono 16 bits, puis les échantillons', async () => {
  const b = Buffer.from(await wavDe(Int16Array.from([0, 1000, -1000])).arrayBuffer())
  assert.equal(b.length, 44 + 6)
  assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWAVE')
  assert.deepEqual([b.readUInt16LE(22), b.readUInt32LE(24), b.readUInt16LE(34), b.readUInt32LE(40)], [1, R, 16, 6])
  assert.equal(b.readInt16LE(46), 1000)
  assert.equal(b.readInt16LE(48), -1000)
})

test('fichiers audio reconnus', () => {
  assert.equal(estAudio({ name: 'Réunion.m4a', type: '' }), true)
  assert.equal(estAudio({ name: 'x', type: 'audio/mpeg' }), true)
  assert.equal(estAudio({ name: 'facture.pdf', type: 'application/pdf' }), false)
})
