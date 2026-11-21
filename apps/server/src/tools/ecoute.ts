import type { Tool } from './types.ts'

/** « Passe en mode conversation », « arrête d'écouter » : le micro de l'appareil qui parle reste ouvert, ou se referme. */
export const conversationMode: Tool = {
  name: 'mode_conversation',
  description:
    "Active ou coupe le mode conversation sur l'appareil qui te parle : tant qu'il est actif, le micro reste ouvert et il te parle sans redire ton nom ; il se coupe seul après un long silence de sa voix ou à la mise en veille. À utiliser quand il dit « passe en mode conversation », « reste à l'écoute », « écoute-moi sans que je t'appelle » (actif: true), ou « arrête d'écouter », « sors du mode conversation », « ferme le micro » (actif: false). Le résultat dit ce qui s'est passé : répète-le en une phrase courte. Refusé sans empreinte vocale : dis-lui de l'enregistrer dans Réglages, « Votre voix ».",
  risk: 'preparation',
  input_schema: {
    type: 'object',
    properties: { actif: { type: 'boolean', description: 'true pour activer, false pour couper.' } },
    required: ['actif'],
    additionalProperties: false
  },
  validate: (input) => (typeof input.actif === 'boolean' ? null : 'Champ « actif » manquant.'),
  async run(input, ctx) {
    if (!ctx.conversation) return { content: 'Le mode conversation ne se règle que de vive voix ou depuis un appareil.', isError: true, summary: 'Mode conversation : indisponible ici' }
    const { ok, message } = ctx.conversation(input.actif === true)
    return { content: message, ...(ok ? {} : { isError: true }), summary: `Mode conversation : ${input.actif ? (ok ? 'activé' : 'refusé') : 'coupé'}` }
  }
}
