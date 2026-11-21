import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feelsLike, meteoText, sky, summarize, type Forecast } from './meteo.ts'
import { showWebResults } from './web.ts'

test('météo : codes de MET Norway → ciel et libellé français', () => {
  assert.deepEqual(sky('partlycloudy_day'), { ciel: 'eclaircies', libelle: 'Partiellement nuageux', nuit: false })
  assert.deepEqual(sky('lightrainshowers_night'), { ciel: 'pluie', libelle: 'Averses faibles', nuit: true })
  assert.deepEqual(sky('heavyrain'), { ciel: 'pluie', libelle: 'Pluie forte', nuit: false })
  assert.deepEqual(sky('rainshowersandthunder_day'), { ciel: 'orage', libelle: 'Averses orageuses', nuit: false })
  assert.deepEqual(sky('clearsky_night'), { ciel: 'soleil', libelle: 'Nuit claire', nuit: true })
  assert.equal(sky('fog').ciel, 'brouillard')
})

test('météo : ressenti seulement quand il fait chaud et humide', () => {
  assert.equal(feelsLike(30, 75), 36)
  assert.equal(feelsLike(24.1, 90), 24)
  assert.equal(feelsLike(31, 30), 31)
})

/** Prévisions fictives : toutes les heures du 30 au 31 octobre, puis par 6 h. */
function fixture(): Forecast {
  const series: Forecast['properties']['timeseries'] = []
  const start = Date.UTC(2026, 9, 30, 18)
  for (let h = 0; h < 30; h++) {
    const time = new Date(start + h * 3600_000).toISOString()
    const rain = h === 3 ? 1.2 : h === 4 ? 0.4 : 0
    series.push({
      time,
      data: {
        instant: { details: { air_temperature: 26 + (h % 24 > 14 ? 4 : 0), wind_speed: 3, relative_humidity: 80 } },
        next_1_hours: { summary: { symbol_code: rain ? 'rainshowers_night' : 'partlycloudy_night' }, details: { precipitation_amount: rain } },
        next_6_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 9 } },
        next_12_hours: { summary: { symbol_code: 'lightrainshowers_day' } }
      }
    })
  }
  for (let h = 30; h < 30 + 6 * 12; h += 6) {
    series.push({
      time: new Date(start + h * 3600_000).toISOString(),
      data: {
        instant: { details: { air_temperature: 24 + (h % 24 === 12 ? 7 : 0) } },
        next_6_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 2 } },
        next_12_hours: { summary: { symbol_code: 'cloudy' } }
      }
    })
  }
  return { properties: { meta: { updated_at: '2026-10-30T18:05:00Z' }, timeseries: series } }
}

test('météo : maintenant, 12 heures à venir, jours à l’heure locale', () => {
  const m = summarize(fixture(), 'Lyon', 'UTC', new Date('2026-10-30T18:20:00Z'))
  assert.equal(m.maj, '18:05')
  assert.equal(m.maintenant.temp, 26)
  assert.equal(m.maintenant.vent, 11)
  assert.equal(m.maintenant.libelle, 'Partiellement nuageux')
  assert.equal(m.heures.length, 12)
  assert.deepEqual(m.heures[2], { heure: '21:00', temp: 26, ciel: 'pluie', nuit: true, pluie: 1.2 })
  assert.deepEqual(
    m.jours.map((j) => j.jour),
    ['Aujourd’hui', 'Demain', 'Dim. 1', 'Lun. 2', 'Mar. 3']
  )
  // Le 31 : la pluie heure par heure (pas les cumuls sur 6 h qui se chevauchent), le ciel de fin de matinée.
  const demain = m.jours[1]!
  assert.equal(demain.libelle, 'Averses faibles')
  assert.equal(demain.pluie, 0)
  assert.deepEqual([demain.min, demain.max], [26, 30])
  assert.equal(m.jours[2]!.max, 31)
  const text = meteoText(m)
  assert.match(text, /Pluie prévue vers 21:00 \(1,6 mm/)
  assert.match(text, /Demain : 26 à 30 °C, averses faibles\./)
})

test('résultats web : adresses valides exigées, site déduit de l’adresse', async () => {
  const ctx = {} as never
  assert.match(showWebResults.validate({ requete: 'x', resultats: [{ titre: 'a', url: 'javascript:alert(1)' }] }, ctx)!, /adresse invalide/)
  assert.match(showWebResults.validate({ requete: 'x', resultats: [] }, ctx)!, /au moins un/)
  const input = { requete: 'appels d’offres nettoyage', resultats: [{ titre: 'Marché public n°12', url: 'https://www.boamp.fr/avis/12', resume: 'Nettoyage de 4 sites, dépôt le 15 nov.' }] }
  assert.equal(showWebResults.validate(input, ctx), null)
  const r = await showWebResults.run(input, ctx)
  assert.deepEqual(r.view, { kind: 'web', requete: 'appels d’offres nettoyage', resultats: [{ titre: 'Marché public n°12', site: 'boamp.fr', url: 'https://www.boamp.fr/avis/12', resume: 'Nettoyage de 4 sites, dépôt le 15 nov.' }] })
})
