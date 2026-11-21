import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { PairInfo } from '@code/protocol'
import { codeConfig } from '../../../config/code.config.ts'

const run = promisify(execFile)

const APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

/**
 * Façons d'appeler la commande Tailscale : Homebrew, le raccourci installé par l'app, puis l'app
 * elle-même. Lancé directement par un service launchd (environnement minimal), l'exécutable de
 * l'app croit qu'on ouvre l'interface et répond « The Tailscale GUI failed to start » ; passé
 * par /bin/sh, il se comporte en ligne de commande.
 */
const CANDIDATES: { bin: string; pre: string[]; when?: string }[] = [
  { bin: '/opt/homebrew/bin/tailscale', pre: [] },
  { bin: '/usr/local/bin/tailscale', pre: [] },
  { bin: '/bin/sh', pre: ['-c', '"$0" "$@"', APP], when: APP },
  { bin: 'tailscale', pre: [] }
]

async function tailscale(args: string[]): Promise<string | null> {
  let found = false
  for (const c of CANDIDATES) {
    if (c.bin.startsWith('/') && !existsSync(c.when ?? c.bin)) continue
    try {
      const { stdout } = await run(c.bin, [...c.pre, ...args], { timeout: 5_000 })
      found = true
      if (/GUI failed to start/.test(stdout)) continue
      return stdout
    } catch (err) {
      // Introuvable : on essaie le suivant. Trouvée mais en échec : on renvoie ce qu'elle a dit.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      found = true
      const out = (err as { stdout?: string }).stdout ?? ''
      if (/GUI failed to start/.test(out)) continue
      return out
    }
  }
  return found ? '' : null
}

/**
 * Ce qu'il faut pour associer un téléphone : l'adresse publique du serveur, sinon son adresse HTTPS sur le
 * réseau Tailscale, ou l'étape qui manque. Le lien contient un code d'association à usage unique (dix
 * minutes), jamais un jeton ; il n'est donné qu'à l'app de bureau. `cle` : `p` pour une association, `i` pour
 * une invitation (création d'un compte).
 */
export async function pairInfo(port: number, code: string, cle: 'p' | 'i' = 'p'): Promise<PairInfo> {
  // Hébergé (VPS, Docker) : l'adresse publique du serveur, sans Tailscale.
  const { publicUrl } = codeConfig.server
  if (publicUrl) return { status: 'pret', host: new URL(publicUrl).host, url: `${publicUrl}/#${cle}=${encodeURIComponent(code)}`, message: 'Scannez ce code avec l’appareil photo du téléphone.' }
  const raw = await tailscale(['status', '--json'])
  if (raw === null) return { status: 'sans_tailscale', message: 'Tailscale n’est pas installé sur cet ordinateur.' }
  let st: { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null }
  try {
    st = JSON.parse(raw)
  } catch {
    return { status: 'deconnecte', message: 'Tailscale ne répond pas : ouvrez l’app Tailscale sur l’ordinateur.' }
  }
  if (st.BackendState !== 'Running') return { status: 'deconnecte', message: 'Tailscale est installé mais pas connecté : ouvrez l’app et connectez-vous.' }
  const host = (st.Self?.DNSName ?? '').replace(/\.$/, '')
  if (!host || !st.CertDomains?.length) {
    return { status: 'sans_https', ...(host ? { host } : {}), message: 'Activez MagicDNS et HTTPS Certificates dans la console Tailscale (onglet DNS).' }
  }
  const serve = (await tailscale(['serve', 'status', '--json'])) ?? ''
  if (!new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(serve)) {
    return { status: 'sans_serve', host, command: `tailscale serve --bg ${port}`, message: `Le serveur n’est pas encore publié sur votre réseau Tailscale.` }
  }
  return { status: 'pret', host, url: `https://${host}/#${cle}=${encodeURIComponent(code)}`, message: 'Scannez ce code avec l’appareil photo du téléphone.' }
}
