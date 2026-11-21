#!/usr/bin/env node
/**
 * Vérification avant publication : rien de secret ni de personnel dans le dépôt, historique compris.
 *
 * Ce qui est lu : chaque version de chaque fichier de chaque commit, plus les fichiers du dossier que git
 * suivrait (ajoutés ou pas encore, hors `.gitignore`).
 *
 * Ce qui est refusé :
 * - des secrets reconnaissables (clés Anthropic, OpenAI, Google, GitHub, clés privées…) ;
 * - des adresses IP publiques et des domaines d'hébergement improvisé (sslip.io, nip.io) ;
 * - des fichiers qui n'ont rien à faire dans git (`.env`, bases SQLite, modèles, certificats, mémoire) ;
 * - chaque mot de la liste locale `.publication-interdits.txt` (noms de personnes, de clients, domaines…) ;
 * - dans le dossier, les anciennes icônes de CODE (CODE 2.0 a les siennes : `npm run icones`).
 *
 * La liste locale ne doit JAMAIS être dans git : un dépôt public révélerait les noms qu'elle protège.
 * Une entrée par ligne, `#` pour un commentaire ; la casse et les accents ne comptent pas (« Dupre »
 * attrape « DUPRÉ »). Une entrée qui commence par `re:` est une expression régulière ; par `!`, une
 * expression autorisée, effacée de la ligne avant la recherche (« !Africa/Dupre » laisse passer ce
 * fuseau horaire, mais pas « Dupre » ailleurs).
 *
 * Usage :
 *   node scripts/verifier-publication.mjs            liste locale facultative (intégration continue)
 *   node scripts/verifier-publication.mjs --strict   liste locale obligatoire (avant un push)
 *   --liste <fichier>                                 une autre liste que `.publication-interdits.txt`
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LISTE_PAR_DEFAUT = '.publication-interdits.txt'
const TAILLE_MAX = 5 * 1024 * 1024

/** Secrets reconnaissables à leur forme. */
export const SECRETS = [
  { nom: 'clé Anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { nom: 'clé OpenAI', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { nom: 'clé ElevenLabs', re: /\bsk_[a-f0-9]{48}\b/ },
  { nom: 'clé Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nom: 'client OAuth Google', re: /\b\d{6,}-[a-z0-9]{32}\.apps\.googleusercontent\.com\b/ },
  { nom: 'secret OAuth Google', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/ },
  { nom: 'jeton GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { nom: 'jeton Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { nom: 'clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nom: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nom: 'hébergement par adresse IP', re: /\b[\w.-]+\.(?:sslip|nip)\.io\b/i }
]

/** Fichiers refusés quel que soit leur contenu (sauf les modèles `.example`). */
export const FICHIERS_INTERDITS = [
  { nom: 'variables d’environnement', re: /(^|\/)\.env(\.[\w-]+)?$/, sauf: /\.example$/ },
  { nom: 'base de données', re: /\.(sqlite3?|db)(-wal|-shm)?$/i },
  { nom: 'modèle', re: /\.(onnx|bin|gguf|safetensors)$/i },
  { nom: 'certificat ou clé', re: /\.(pem|key|p12|pfx|keystore|jks|mobileprovision)$/i },
  { nom: 'mémoire personnelle', re: /(^|\/)memory\/(?!LISEZMOI\.md$)[^/]+\.md$/ },
  { nom: 'liste des mots interdits', re: /(^|\/)\.publication-interdits\.txt$/ }
]

/**
 * Empreintes SHA-256 des icônes de CODE, reprises au début de CODE 2.0 puis remplacées. Seul le dossier
 * est vérifié : l'historique les contient encore (à repartir d'un historique neuf pour publier).
 */
export const ANCIENNES_ICONES = new Set([
  '7471999f16b277e45ca92885f51401843d0f4a51ebe2e3f1a146bd47838c6d09',
  '2090109728332ad847fa661c14bfe9766ca245e4e1f507d1863e0e6497ecfe22',
  '7d65815dba358d0e700b3c9e2614d18dfcb541b76f08e76cab4e8922b87100f4',
  '3044883e6aca0dfdd8a10d12b2578d4471aecb67aa06cc310544c1f789d3ab91',
  '52146717fcadea05dad5cbc829ae10eeeb793b2dcf0810ec2eb91dd8298a7102',
  '201c702a04f689b46064303c468d41a4e9935ea07ea5d8d70efba3d4a039eeee',
  'cb214eae19b9adf93a4950c8e9370cb19019eefb909f44ca17889849ab4b0359',
  'dc2a59736902a73aa594816e179a013fdb739c36d743027e265afd33fa8c35ca'
])

/** Le contenu est-il l'une des anciennes icônes ? */
export function estAncienneIcone(contenu, empreintes = ANCIENNES_ICONES) {
  return empreintes.has(createHash('sha256').update(contenu).digest('hex'))
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

/** Une adresse IP qui ne désigne qu'une machine locale ou un réseau privé (et les exemples de la RFC 5737). */
function ipAutorisee(ip) {
  const o = ip.split('.').map(Number)
  if (o.some((n) => n > 255)) return true // pas une adresse : un numéro de version
  const [a, b, c] = o
  return (
    a === 0 || a === 10 || a === 127 || a === 255 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

/** Sans casse ni accents : la comparaison des mots interdits. */
export function plier(texte) {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function lireListe(chemin) {
  return readFileSync(chemin, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.startsWith('re:') ? { nom: l, re: new RegExp(l.slice(3), 'iu') } : l.startsWith('!') ? { nom: l, autorise: plier(l.slice(1)) } : { nom: l, mot: plier(l) }))
}

/** Un extrait lisible sans recopier le secret : ses quatre premiers caractères. */
function masquer(trouve) {
  return trouve.length <= 6 ? trouve : `${trouve.slice(0, 4)}…(${trouve.length})`
}

/** Les problèmes d'un fichier texte, ligne par ligne. */
export function analyserTexte(texte, interdits) {
  const problemes = []
  texte.split('\n').forEach((ligne, i) => {
    for (const { nom, re } of SECRETS) {
      const m = ligne.match(re)
      if (m) problemes.push({ ligne: i + 1, regle: nom, extrait: masquer(m[0]) })
    }
    for (const ip of ligne.match(IPV4) ?? []) {
      if (!ipAutorisee(ip)) problemes.push({ ligne: i + 1, regle: 'adresse IP publique', extrait: ip })
    }
    let pliee = plier(ligne)
    for (const entree of interdits) if (entree.autorise) pliee = pliee.split(entree.autorise).join(' ')
    for (const entree of interdits) {
      if (entree.autorise) continue
      const touche = entree.re ? entree.re.test(ligne) : pliee.includes(entree.mot)
      if (touche) problemes.push({ ligne: i + 1, regle: 'mot interdit', extrait: entree.nom })
    }
  })
  return problemes
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 1024 * 1024 * 1024, ...options })
}

/** Les versions de fichiers de tout l'historique : `oid → { chemin, commit }` (la première rencontrée). */
function blobsDeLHistorique() {
  const blobs = new Map()
  let commits = []
  try {
    commits = git(['rev-list', '--all']).toString().split('\n').filter(Boolean)
  } catch {
    return blobs // dépôt sans commit
  }
  for (const commit of commits) {
    const entrees = git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString().split('\0').filter(Boolean)
    for (const entree of entrees) {
      const [meta, chemin] = entree.split('\t')
      const [, type, oid] = meta.split(' ')
      if (type === 'blob' && !blobs.has(oid)) blobs.set(oid, { chemin, commit: commit.slice(0, 8) })
    }
  }
  return blobs
}

/** Le contenu de nombreux objets git d'un coup (`git cat-file --batch`). */
function lireBlobs(oids) {
  const contenus = new Map()
  if (!oids.length) return contenus
  const sortie = git(['cat-file', '--batch'], { input: oids.join('\n') + '\n' })
  let pos = 0
  while (pos < sortie.length) {
    const fin = sortie.indexOf(0x0a, pos)
    const [oid, , taille] = sortie.subarray(pos, fin).toString().split(' ')
    const debut = fin + 1
    contenus.set(oid, sortie.subarray(debut, debut + Number(taille)))
    pos = debut + Number(taille) + 1
  }
  return contenus
}

function estBinaire(contenu) {
  return contenu.subarray(0, 8000).includes(0)
}

/** Tous les problèmes du dépôt courant. Chaque problème : `{ chemin, ou, ligne?, regle, extrait }`. */
export function verifier({ interdits = [] } = {}) {
  const problemes = []
  const examiner = (chemin, ou, contenu) => {
    for (const f of FICHIERS_INTERDITS) {
      if (f.re.test(chemin) && !(f.sauf && f.sauf.test(chemin))) problemes.push({ chemin, ou, regle: `fichier interdit (${f.nom})`, extrait: '' })
    }
    if (ou === 'dossier' && estAncienneIcone(contenu)) problemes.push({ chemin, ou, regle: 'ancienne icône de CODE', extrait: '' })
    if (contenu.length > TAILLE_MAX) problemes.push({ chemin, ou, regle: 'fichier de plus de 5 Mo', extrait: `${Math.round(contenu.length / 1024 / 1024)} Mo` })
    if (estBinaire(contenu)) return
    for (const p of analyserTexte(contenu.toString('utf8'), interdits)) problemes.push({ chemin, ou, ...p })
  }

  const blobs = blobsDeLHistorique()
  const contenus = lireBlobs([...blobs.keys()])
  for (const [oid, { chemin, commit }] of blobs) examiner(chemin, `commit ${commit}`, contenus.get(oid))

  // Le dossier tel qu'il est : ce qui serait dans le prochain commit.
  const fichiers = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean)
  for (const chemin of fichiers) {
    if (!existsSync(chemin) || !statSync(chemin).isFile()) continue
    examiner(chemin, 'dossier', readFileSync(chemin))
  }

  // Un même problème vu dans l'historique et le dossier n'est montré qu'une fois.
  const vus = new Set()
  return problemes.filter((p) => {
    const cle = `${p.chemin}|${p.ligne}|${p.regle}|${p.extrait}`
    if (vus.has(cle)) return false
    vus.add(cle)
    return true
  })
}

function principal(argv) {
  const strict = argv.includes('--strict')
  const i = argv.indexOf('--liste')
  const racine = git(['rev-parse', '--show-toplevel']).toString().trim()
  const liste = i >= 0 ? argv[i + 1] : join(racine, LISTE_PAR_DEFAUT)
  process.chdir(racine)

  let interdits = []
  if (existsSync(liste)) {
    interdits = lireListe(liste)
    console.log(`Liste locale : ${interdits.length} mot(s) interdit(s).`)
  } else if (strict) {
    console.error(`Liste locale introuvable (${liste}) : impossible de vérifier les noms avant publication.`)
    process.exit(2)
  } else {
    console.log('Pas de liste locale : seuls les secrets, adresses et fichiers interdits sont vérifiés.')
  }

  const problemes = verifier({ interdits })
  if (!problemes.length) {
    console.log('Rien à signaler : le dépôt peut être publié.')
    return
  }
  for (const p of problemes) {
    const ou = p.ligne ? `${p.chemin}:${p.ligne}` : p.chemin
    console.error(`✗ ${ou} [${p.ou}] — ${p.regle}${p.extrait ? ` : ${p.extrait}` : ''}`)
  }
  console.error(`\n${problemes.length} problème(s) : publication refusée.`)
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal(process.argv.slice(2))
