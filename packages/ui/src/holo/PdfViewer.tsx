import { useEffect, useRef, useState } from 'react'

const MAX_PAGES = 30

type Props = { url: string; onError: () => void }

/**
 * Le PDF rendu page par page dans l'interface (pdf.js, chargé à la demande).
 * Les pages sont dessinées au fil du défilement pour rester fluide sur les gros documents.
 */
export function PdfViewer({ url, onError }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(0)

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = worker
        const task = pdfjs.getDocument({ url })
        const doc = await task.promise
        if (cancelled || !box.current) return void task.destroy()
        const count = Math.min(doc.numPages, MAX_PAGES)
        setPages(doc.numPages)
        const width = Math.max(320, box.current.clientWidth - 8)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const canvases: HTMLCanvasElement[] = []
        const drawn = new Set<number>()
        const draw = async (n: number) => {
          if (drawn.has(n) || cancelled) return
          drawn.add(n)
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (width / base.width) * dpr })
          const canvas = canvases[n - 1]!
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, viewport }).promise
        }
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) if (e.isIntersecting) void draw(Number((e.target as HTMLElement).dataset.page))
          },
          { root: box.current.closest('.holo-body'), rootMargin: '400px' }
        )
        for (let n = 1; n <= count; n++) {
          const page = await doc.getPage(n)
          const vp = page.getViewport({ scale: 1 })
          const canvas = document.createElement('canvas')
          canvas.className = 'holo-pdf__page'
          canvas.dataset.page = String(n)
          canvas.style.aspectRatio = `${vp.width} / ${vp.height}`
          canvas.style.setProperty('--i', String(Math.min(n - 1, 6)))
          canvas.setAttribute('aria-label', `Page ${n}`)
          canvases.push(canvas)
          box.current?.appendChild(canvas)
          io.observe(canvas)
        }
        cleanup = () => {
          io.disconnect()
          void task.destroy()
        }
      } catch (err) {
        console.error('[pdf]', err)
        if (!cancelled) onError()
      }
    })()
    return () => {
      cancelled = true
      cleanup?.()
      if (box.current) box.current.innerHTML = ''
    }
  }, [url, onError])

  return (
    <div className="holo-pdf">
      <div ref={box} className="holo-pdf__pages" />
      {pages > MAX_PAGES && <p className="holo-more">Les {MAX_PAGES} premières pages sur {pages}. Ouvrez-le sur le Mac pour la suite.</p>}
    </div>
  )
}
