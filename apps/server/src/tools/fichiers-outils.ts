import { fileInfo, listFolder, openFile, readFile, recentFiles, searchFiles, showItem } from './files.ts'
import { copyItems, createFolder, moveItems, renameItem, trashItems, writeFile } from './files-write.ts'
import type { Tool } from './types.ts'

/**
 * Les outils de fichiers tels qu'ils tournent sur le Mac : chargés par le serveur quand il est lui-même
 * sur le Mac, et par l'app Mac quand le serveur est hébergé (le pont, voir `pont/`). Rien d'autre ici,
 * pour que l'app Mac n'embarque que ce code-là.
 */
export const FICHIERS: Tool[] = [listFolder, searchFiles, recentFiles, fileInfo, showItem, readFile, openFile, createFolder, writeFile, renameItem, moveItems, copyItems, trashItems]
