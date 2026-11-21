import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { syntheseEffective, transcriptionEffective, type CleApi } from '@code/protocol'
import { SttUnavailable, openStt } from './stt.ts'
import { createTts } from './tts.ts'
import { codeConfig } from '../../../../config/code.config.ts'
import { bibliotheque, voixDuCompte } from './elevenlabs-voix.ts'

const avec = (...cles: CleApi[]) => (c: CleApi) => cles.includes(c)
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('transcription : le choix avec sa clé, sinon le premier disponible (repli signalé)', () => {
  assert.deepEqual(transcriptionEffective('mistral', avec('MISTRAL_API_KEY', 'ELEVENLABS_API_KEY')), { finale: 'mistral', direct: false, repli: false })
  assert.deepEqual(transcriptionEffective('auto', avec('GROQ_API_KEY', 'OPENAI_API_KEY')), { finale: 'groq', direct: false, repli: false })
  assert.deepEqual(transcriptionEffective('openai', avec('DEEPGRAM_API_KEY')), { finale: 'deepgram', direct: true, repli: true })
  // Deepgram écrit le texte en direct même quand un autre écrit la phrase finale.
  assert.deepEqual(transcriptionEffective('auto', avec('DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY')), { finale: 'elevenlabs', direct: true, repli: false })
  assert.deepEqual(transcriptionEffective('auto', avec('ANTHROPIC_API_KEY')), { finale: null, direct: false, repli: false })
})

test('synthèse : le choix avec sa clé, sinon le premier disponible, sinon aucune voix', () => {
  assert.deepEqual(syntheseEffective('gemini', avec('GEMINI_API_KEY', 'OPENAI_API_KEY')), { synthese: 'gemini', repli: false })
  assert.deepEqual(syntheseEffective('deepgram', avec('OPENAI_API_KEY')), { synthese: 'openai', repli: true })
  assert.deepEqual(syntheseEffective('auto', avec('GROQ_API_KEY')), { synthese: null, repli: false })
})

test('openStt : sans clé de transcription, une erreur claire', () => {
  assert.throws(() => openStt({ ANTHROPIC_API_KEY: 'k' }, () => {}), SttUnavailable)
})

test('openStt : la phrase finie part chez le service choisi (Mistral, OpenAI, Groq)', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url))
    return new Response(JSON.stringify({ text: ' bonjour ' }), { status: 200 })
  }) as typeof fetch
  const secrets = { MISTRAL_API_KEY: 'm', OPENAI_API_KEY: 'o', GROQ_API_KEY: 'g' }
  for (const choix of ['mistral', 'openai', 'groq'] as const) {
    const stt = openStt(secrets, () => {}, undefined, choix)
    stt.write(Buffer.alloc(16_000))
    assert.equal(await stt.finish(), 'bonjour')
  }
  assert.deepEqual(urls, [
    'https://api.mistral.ai/v1/audio/transcriptions',
    'https://api.openai.com/v1/audio/transcriptions',
    'https://api.groq.com/openai/v1/audio/transcriptions'
  ])
})

test('createTts : chaque phrase passe par le service choisi, ou le premier disponible', async () => {
  const urls: string[] = []
  const pcm = Buffer.alloc(4_800)
  globalThis.fetch = (async (url: string | URL) => {
    urls.push(String(url).split('?')[0]!)
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }] }), { status: 200 })
    }
    return new Response(new Uint8Array(pcm), { status: 200 })
  }) as typeof fetch
  const tts = await createTts({ DEEPGRAM_API_KEY: 'd', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' })
  assert.ok(tts)
  const lire = async (synthese: 'deepgram' | 'gemini' | 'elevenlabs' | 'auto') => {
    let n = 0
    for await (const part of tts.synthesize('Bonjour.', new AbortController().signal, { synthese })) n += part.length
    return n
  }
  assert.equal(await lire('deepgram'), pcm.length)
  assert.equal(await lire('gemini'), pcm.length)
  // ElevenLabs sans sa clé : l'automatique prend OpenAI, premier disponible.
  await lire('elevenlabs')
  assert.deepEqual(urls, ['https://api.deepgram.com/v1/speak', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', 'https://api.openai.com/v1/audio/speech'])
  assert.equal(tts.decrire('elevenlabs'), 'openai · onyx')
  assert.equal(await createTts({ GROQ_API_KEY: 'g' }), null)
})

test('ElevenLabs : la voix de son compte et le modèle naturel ; voix retirée, celle par défaut prend le relais', async () => {
  const corps: { voix: string; modele: string; langue?: string }[] = []
  const pcm = Buffer.alloc(4_800)
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/v1/voices')) return new Response(JSON.stringify({ voices: [] }), { status: 200 })
    const voix = u.split('/text-to-speech/')[1]!.split('/')[0]!
    const b = JSON.parse(String(init?.body)) as { model_id: string; language_code?: string }
    corps.push({ voix, modele: b.model_id, ...(b.language_code ? { langue: b.language_code } : {}) })
    if (voix === 'RetireeDuCompte00000') return new Response(JSON.stringify({ detail: { status: 'voice_not_found' } }), { status: 404 })
    return new Response(new Uint8Array(pcm), { status: 200 })
  }) as typeof fetch
  const tts = await createTts({ ELEVENLABS_API_KEY: 'e' })
  assert.ok(tts)
  const dire = async (o: { voix?: string; qualite?: 'rapide' | 'naturelle' }) => {
    for await (const _ of tts.synthesize('Bonjour.', new AbortController().signal, { synthese: 'elevenlabs', ...o }));
  }
  await dire({ voix: 'VoixDeSonCompte00001', qualite: 'naturelle' })
  await dire({ voix: 'RetireeDuCompte00000' })
  const defaut = codeConfig.voice.tts.elevenlabsVoiceId
  assert.deepEqual(corps, [
    { voix: 'VoixDeSonCompte00001', modele: 'eleven_multilingual_v2' },
    { voix: 'RetireeDuCompte00000', modele: 'eleven_flash_v2_5', langue: 'fr' },
    { voix: defaut, modele: 'eleven_flash_v2_5', langue: 'fr' }
  ])
})

test('ElevenLabs : ses voix propres (pas celles de base), la bibliothèque française étiquetée en français', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/v1/voices')) {
      return new Response(JSON.stringify({ voices: [
        { voice_id: 'BaseAnglaise00000000', name: 'Base', category: 'premade' },
        { voice_id: 'AjouteeBiblio0000001', name: 'Léa', category: 'professional', labels: { gender: 'female', age: 'young', use_case: 'conversational' } }
      ] }), { status: 200 })
    }
    return new Response(JSON.stringify({ has_more: true, voices: [
      { public_owner_id: 'auteur123456', voice_id: 'AjouteeBiblio0000001', name: 'Léa', gender: 'female', age: 'young', accent: 'parisian', descriptive: 'calm', use_case: 'conversational', preview_url: 'https://exemple.test/en.mp3', verified_languages: [{ language: 'fr', preview_url: 'https://exemple.test/fr.mp3' }], cloned_by_count: 42 },
      { public_owner_id: 'auteur654321', voice_id: 'NouvelleBiblio000002', name: 'Marc', gender: 'male', age: 'middle_aged', accent: 'canadian', use_case: 'narrative_story', preview_url: null }
    ] }), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await voixDuCompte('cle-test-compte'), [{ id: 'AjouteeBiblio0000001', nom: 'Léa', description: 'Femme · Jeune · Conversation', source: 'compte' }])
  const page = await bibliotheque('cle-test-compte', { genre: 'femme', usage: 'conversation', recherche: ' calme ' })
  assert.equal(page.suite, true)
  assert.deepEqual(page.voix.map((v) => [v.nom, v.etiquettes.join(' · '), v.apercu, v.ajoutee]), [
    ['Léa', 'Femme · Jeune · Calme · Conversation · Accent parisien', 'https://exemple.test/fr.mp3', true],
    ['Marc', 'Homme · Adulte · Narration · Accent québécois', null, false]
  ])
  const q = new URL(urls.find((u) => u.includes('shared-voices'))!).searchParams
  assert.equal(q.get('language'), 'fr')
  assert.equal(q.get('gender'), 'female')
  assert.equal(q.get('use_cases'), 'conversational')
  assert.equal(q.get('search'), 'calme')
})
