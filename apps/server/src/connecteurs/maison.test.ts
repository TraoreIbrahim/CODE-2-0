import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import type { ToolContext } from '../tools/types.ts'
import { appareil, baseMaison, Maison, mots, serviceDe, trouver, visible, type Etat } from './maison.ts'

const E = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): Etat => ({ entity_id, state, attributes })

const ETATS: Etat[] = [
  E('light.plafonnier', 'on', { friendly_name: 'Plafonnier', brightness: 178 }),
  E('light.lampe_lecture', 'off', { friendly_name: 'Lampe de lecture' }),
  E('light.chevet', 'off', { friendly_name: 'Chevet' }),
  E('light.chevet_amis', 'off', { friendly_name: 'Chevet invités' }),
  E('climate.clim_chambre', 'cool', { friendly_name: 'Clim', current_temperature: 25.5, temperature: 22 }),
  E('media_player.tele', 'playing', { friendly_name: 'Télé', app_name: 'Netflix', volume_level: 0.3 }),
  E('lock.porte_entree', 'locked', { friendly_name: 'Porte d’entrée' }),
  E('cover.garage', 'closed', { friendly_name: 'Garage', device_class: 'garage' }),
  E('cover.volet_salon', 'open', { friendly_name: 'Volet', current_position: 100 }),
  E('camera.entree', 'idle', { friendly_name: 'Entrée' }),
  E('binary_sensor.fenetre', 'on', { friendly_name: 'Fenêtre', device_class: 'window' }),
  E('sensor.batterie', '80', { friendly_name: 'Batterie', device_class: 'battery' }),
  E('sensor.temp_salon', '21.4', { friendly_name: 'Température', device_class: 'temperature', unit_of_measurement: '°C' })
]
const PIECES = new Map([
  ['light.plafonnier', 'Salon'],
  ['light.lampe_lecture', 'Salon'],
  ['light.chevet', 'Chambre'],
  ['light.chevet_amis', 'Chambre d’amis'],
  ['climate.clim_chambre', 'Chambre'],
  ['media_player.tele', 'Salon'],
  ['cover.volet_salon', 'Salon'],
  ['sensor.temp_salon', 'Salon']
])

describe('maison : lecture des appareils', () => {
  test('adresse : la base de l’installation, quelle que soit la page copiée', () => {
    assert.equal(baseMaison('http://homeassistant.local:8123/lovelace/0'), 'http://homeassistant.local:8123')
    assert.equal(baseMaison('https://abc.ui.nabu.casa/api/'), 'https://abc.ui.nabu.casa')
    assert.equal(baseMaison('http://192.168.1.20:8123/'), 'http://192.168.1.20:8123')
    assert.throws(() => baseMaison('ftp://maison'))
  })

  test('mots : sans accents, pluriels ni petits mots', () => {
    assert.deepEqual(mots('Les lumières du salon'), ['lumiere', 'salon'])
  })

  test('visible : les appareils et les capteurs utiles, pas les batteries', () => {
    assert.equal(visible(E('sensor.batterie', '80', { device_class: 'battery' })), false)
    assert.equal(visible(E('sensor.t', '21', { device_class: 'temperature' })), true)
    assert.equal(visible(E('automation.x', 'on')), false)
  })

  test('appareil : l’état en mots', () => {
    const l = appareil(ETATS[0]!, 'Salon')
    assert.equal(l.etat, 'allumée')
    assert.equal(l.detail, '70\u00a0%')
    assert.equal(l.basculable, true)
    const c = appareil(ETATS[4]!)
    assert.equal(c.etat, '25,5\u00a0°C · froid')
    assert.equal(c.detail, 'consigne 22\u00a0°C')
    assert.equal(c.actif, true)
    const s = appareil(E('lock.p', 'unlocked'))
    assert.equal(s.alerte, true)
    assert.equal(s.sensible, true)
    assert.equal(s.basculable, false)
    assert.equal(appareil(ETATS[10]!).etat, 'ouverte')
    assert.equal(appareil(E('light.x', 'unavailable')).indisponible, true)
  })

  test('trouver : par nom, par pièce et type, la pièce la plus juste', () => {
    const ids = (q: string) => trouver(ETATS, PIECES, q).map((e) => e.entity_id).sort()
    assert.deepEqual(ids('lumières du salon'), ['light.lampe_lecture', 'light.plafonnier'])
    assert.deepEqual(ids('plafonnier'), ['light.plafonnier'])
    assert.deepEqual(ids('lumière chambre'), ['light.chevet'])
    assert.deepEqual(ids('clim'), ['climate.clim_chambre'])
    assert.deepEqual(ids('télé'), ['media_player.tele'])
    assert.deepEqual(ids('portail garage'), ['cover.garage'])
    assert.deepEqual(ids('light.chevet_amis'), ['light.chevet_amis'])
    assert.deepEqual(ids('piscine'), [])
  })

  test('serviceDe : le bon service Home Assistant', () => {
    assert.deepEqual(serviceDe(ETATS[4]!, 'regler', { temperature: 23, mode: 'froid' }), { domaine: 'climate', service: 'set_temperature', donnees: { temperature: 23, hvac_mode: 'cool' } })
    assert.deepEqual(serviceDe(ETATS[0]!, 'allumer', { luminosite: 40, couleur: 'Blanc chaud' }), { domaine: 'light', service: 'turn_on', donnees: { brightness_pct: 40, color_temp_kelvin: 2700 } })
    assert.deepEqual(serviceDe(ETATS[5]!, 'regler', { volume: 25 }), { domaine: 'media_player', service: 'volume_set', donnees: { volume_level: 0.25 } })
    assert.deepEqual(serviceDe(ETATS[6]!, 'deverrouiller', {}), { domaine: 'lock', service: 'unlock', donnees: {} })
    assert.ok('erreur' in serviceDe(ETATS[4]!, 'regler', { temperature: 45 }))
    assert.ok('erreur' in serviceDe(ETATS[0]!, 'allumer', { couleur: 'fuchsia pâle' }))
    assert.ok('erreur' in serviceDe(ETATS[6]!, 'lecture', {}))
  })
})

describe('maison : un Home Assistant local', () => {
  let serveur: Server
  let base = ''
  const appels: { chemin: string; corps: Record<string, unknown> }[] = []
  const etats = new Map(ETATS.map((e) => [e.entity_id, structuredClone(e)]))

  before(async () => {
    serveur = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer bon-jeton') return void res.writeHead(401).end('401: Unauthorized')
      let brut = ''
      req.on('data', (c) => (brut += c))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x')
        const json = (v: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
        if (url.pathname === '/api/') return json({ message: 'API running.' })
        if (url.pathname === '/api/states') return json([...etats.values()])
        if (url.pathname.startsWith('/api/states/')) {
          const e = etats.get(decodeURIComponent(url.pathname.slice(12)))
          return e ? json(e) : void res.writeHead(404).end()
        }
        if (url.pathname === '/api/template') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end(JSON.stringify([...PIECES.entries()]))
        if (url.pathname.startsWith('/api/services/')) {
          const corps = JSON.parse(brut || '{}') as Record<string, unknown>
          appels.push({ chemin: url.pathname, corps })
          const e = etats.get(String(corps.entity_id))
          if (e && url.pathname.endsWith('/turn_on')) e.state = 'on'
          if (e && url.pathname.endsWith('/unlock')) e.state = 'unlocked'
          return json([])
        }
        if (url.pathname === '/api/camera_proxy/camera.entree') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(Buffer.alloc(400, 7))
        res.writeHead(404).end()
      })
    })
    await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
  })
  after(() => serveur.close())

  const ctx = (o: Partial<ToolContext> = {}) => {
    const attente: (() => Promise<void>)[] = []
    const dit: string[] = []
    const c = { requestConfirmation: (_t: string, _s: string, f: () => Promise<void>) => void attente.push(f), announce: (t: string) => void dit.push(t), log: () => {}, ...o } as unknown as ToolContext
    return { c, attente, dit }
  }

  test('le jeton est vérifié', async () => {
    await new Maison(base, 'bon-jeton').verifier()
    await assert.rejects(new Maison(base, 'mauvais').verifier(), /jeton refusé/)
  })

  test('« allume la lumière de la chambre » : tout de suite, sans carte', async () => {
    const m = new Maison(base, 'bon-jeton')
    const commande = m.outils().find((t) => t.name === 'maison_commande')!
    assert.equal(commande.risk, 'preparation')
    const { c, attente } = ctx()
    const r = await commande.run({ appareils: ['lumière chambre'], action: 'allumer' }, c)
    assert.equal(attente.length, 0)
    assert.deepEqual(appels.at(-1), { chemin: '/api/services/light/turn_on', corps: { entity_id: 'light.chevet' } })
    assert.match(String(r.content), /Chevet : allumée/)
    assert.equal(r.view?.kind, 'maison')
  })

  test('« déverrouille la porte » : la carte d’abord, rien avant le oui ; refusé dans une tâche', async () => {
    const m = new Maison(base, 'bon-jeton')
    const commande = m.outils().find((t) => t.name === 'maison_commande')!
    const avant = appels.length
    const { c, attente, dit } = ctx()
    const r = await commande.run({ appareils: ['porte'], action: 'deverrouiller' }, c)
    assert.match(String(r.content), /En attente de validation/)
    assert.equal(appels.length, avant)
    await attente[0]!()
    assert.equal(appels.at(-1)?.chemin, '/api/services/lock/unlock')
    assert.match(dit[0] ?? '', /C'est fait/)
    const tache = await commande.run({ appareils: ['porte'], action: 'deverrouiller' }, ctx({ unattended: true }).c)
    assert.equal(tache.isError, true)
  })

  test('une pièce entière ne touche ni serrure ni portail', async () => {
    const m = new Maison(base, 'bon-jeton')
    const commande = m.outils().find((t) => t.name === 'maison_commande')!
    const avant = appels.length
    await commande.run({ piece: 'salon', action: 'eteindre' }, ctx().c)
    const touches = appels.slice(avant).map((a) => a.corps.entity_id).sort()
    assert.deepEqual(touches, ['light.lampe_lecture', 'light.plafonnier', 'media_player.tele'])
  })

  test('la caméra : l’image pour Claude et pour l’écran', async () => {
    const m = new Maison(base, 'bon-jeton')
    const camera = m.outils().find((t) => t.name === 'maison_camera')!
    const r = await camera.run({}, ctx().c)
    assert.ok(Array.isArray(r.content))
    assert.equal((r.content as { type: string }[])[0]!.type, 'image')
    assert.equal(r.view?.kind, 'camera')
    assert.match((r.view as { image?: string }).image ?? '', /^data:image\/jpeg;base64,/)
  })

  test('l’état : par pièce, avec la température', async () => {
    const m = new Maison(base, 'bon-jeton')
    const etat = m.outils().find((t) => t.name === 'maison_etat')!
    const r = await etat.run({ piece: 'salon' }, ctx().c)
    assert.match(String(r.content), /sensor\.temp_salon \| Température \| Salon \| capteur \| 21,4\u00a0°C/)
    assert.doesNotMatch(String(r.content), /batterie/i)
  })
})
