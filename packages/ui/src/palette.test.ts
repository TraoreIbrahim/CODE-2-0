import assert from 'node:assert/strict'
import { test } from 'node:test'
import { THEMES } from '@code/protocol'
import { BG, contrast, hexToRgb, luminance, mix, orbFrom, paletteOf, rgbToHex, type Rgb } from './palette.ts'

const bg = hexToRgb(BG)
const parse = (t: string) => t.split(',').map((v) => Number(v.trim())) as Rgb
const valid = (t: string) => {
  const c = parse(t)
  return c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
}
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test('conversions et mélange', () => {
  assert.deepEqual(hexToRgb('#46d7ff'), [70, 215, 255])
  assert.equal(rgbToHex([70, 215, 255]), '#46d7ff')
  assert.deepEqual(mix([0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128])
  assert.deepEqual(mix([10, 20, 30], [200, 100, 0], 0), [10, 20, 30])
  assert.throws(() => hexToRgb('cyan'))
})

test('le cyan d’origine garde exactement les valeurs des maquettes', () => {
  const p = paletteOf('cyan')
  assert.equal(p.vars['--code-cyan'], '#46d7ff')
  assert.equal(p.vars['--code-cyan-rgb'], '70, 215, 255')
  assert.equal(p.vars['--code-cyan-soft'], 'rgba(70, 215, 255, 0.08)')
  assert.equal(p.vars['--code-line'], '#14303c')
  assert.equal(p.vars['--code-contre'], '#ffb547')
  assert.deepEqual(p.orb, { dot: '84,196,238', bright: '200,244,255', core: '205,246,255' })
  assert.deepEqual(p.pensee, { dot: '236,176,92', bright: '255,230,180', core: '255,236,200' })
  // La dérivation générique retombe presque sur les valeurs dessinées à la main.
  const derived = orbFrom([70, 215, 255])
  assert.ok(distance(parse(derived.dot), parse(p.orb.dot)) < 12, `grain dérivé ${derived.dot}`)
  assert.ok(distance(hexToRgb(rgbToHex(mix(bg, [70, 215, 255], 0.2))), hexToRgb('#14303c')) < 8)
})

test('thème inconnu ou absent : le cyan', () => {
  assert.equal(paletteOf('rose').id, 'cyan')
  assert.equal(paletteOf(null).id, 'cyan')
})

test('chaque thème : couleurs valides, lisibles sur le fond, filets discrets, contrepoint distinct', () => {
  assert.equal(THEMES.length, 8)
  for (const id of THEMES) {
    const p = paletteOf(id)
    const accent = hexToRgb(p.accent)
    const fond = hexToRgb(p.vars['--code-bg']!)
    assert.equal(p.id, id)
    assert.ok(p.nom, `${id} : un nom à afficher`)
    assert.deepEqual(Object.keys(p.vars).sort(), [
      '--code-bg',
      '--code-bg-rgb',
      '--code-contre',
      '--code-contre-rgb',
      '--code-cyan',
      '--code-cyan-rgb',
      '--code-cyan-soft',
      '--code-faint',
      '--code-line',
      '--code-line-soft',
      '--code-muted',
      '--code-panel',
      '--code-text',
      '--code-text-2'
    ])
    assert.equal(p.clair, id === 'aube', `${id} : seul Aube est clair`)
    assert.ok(valid(p.vars['--code-cyan-rgb']!) && valid(p.vars['--code-contre-rgb']!), `${id} : triplets`)
    for (const o of [p.orb, p.pensee]) assert.ok(valid(o.dot) && valid(o.bright) && valid(o.core), `${id} : grains de l’orbe`)
    // Texte et contours à la couleur du thème : lisibles sur leur fond (AAA en sombre, AA en clair).
    assert.ok(contrast(accent, fond) >= (p.clair ? 4.5 : 7), `${id} : contraste ${contrast(accent, fond).toFixed(1)}`)
    // Le texte courant reste très lisible.
    assert.ok(contrast(hexToRgb(p.vars['--code-text']!), fond) >= 12, `${id} : texte`)
    // Les filets restent discrets : entre le fond et la couleur, bien plus près du fond.
    const line = hexToRgb(p.vars['--code-line']!)
    if (p.clair) assert.ok(luminance(line) < luminance(fond) && luminance(line) > luminance(accent), `${id} : filet ${p.vars['--code-line']}`)
    else assert.ok(luminance(line) < luminance(accent) / 4 && luminance(line) > luminance(bg), `${id} : filet ${p.vars['--code-line']}`)
    // Le contrepoint se distingue de la couleur principale (logo, orbe qui réfléchit).
    assert.ok(distance(hexToRgb(p.vars['--code-contre']!), accent) > 120, `${id} : contrepoint trop proche`)
    // Le grain qui scintille ressort du grain au repos : plus clair en sombre, plus foncé sur fond clair.
    const [vif, repos] = [luminance(parse(p.orb.bright)), luminance(parse(p.orb.dot))]
    assert.ok(p.clair ? vif < repos : vif > repos, `${id} : scintillement`)
  }
})

test('les thèmes se distinguent les uns des autres', () => {
  const accents = THEMES.map((id) => hexToRgb(paletteOf(id).accent))
  for (let i = 0; i < accents.length; i++) for (let j = i + 1; j < accents.length; j++) assert.ok(distance(accents[i]!, accents[j]!) > 80, `${THEMES[i]} et ${THEMES[j]} trop proches`)
})
