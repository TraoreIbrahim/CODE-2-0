/** Imports d'URL de Vite (`?url`) : le fichier est servi tel quel et l'import renvoie son adresse. */
declare module '*?url' {
  const url: string
  export default url
}
