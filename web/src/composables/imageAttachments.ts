import { ref } from 'vue'
import type { ImageAttachment } from '@shared/types'

export interface PendingImage extends ImageAttachment {
  id: string
  size: number
  /** Object URL for the thumbnail */
  url: string
  /** SHA-256 of the content: the same image isn't added twice */
  hash: string
}

const sha256 = async (data: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Images Claude gets, without repeats (the same screenshot pasted in two places) */
export async function uniqueForDraft(...sets: { images: { value: PendingImage[] }; forDraft: () => Promise<ImageAttachment[]> }[]) {
  const seen = new Set<string>()
  const out: ImageAttachment[] = []
  for (const set of sets) {
    const prepared = await set.forDraft()
    set.images.value.forEach((img, i) => {
      if (seen.has(img.hash)) return
      seen.add(img.hash)
      out.push(prepared[i])
    })
  }
  return out
}

const MAX_IMAGES = 10
const MAX_BYTES = 10 * 1024 * 1024
/** Claude takes images up to ~5 MB and gains nothing past ~1600 px */
const CLAUDE_MAX_SIDE = 1600

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** A smaller copy for Claude (the original is what gets attached to Jira) */
async function forClaude(img: PendingImage): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(await (await fetch(img.url)).blob())
  const scale = Math.min(1, CLAUDE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && img.size < 3.5 * 1024 * 1024) return { name: img.name, type: img.type, data: img.data }
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  return { name: img.name, type: 'image/jpeg', data: await toBase64(blob) }
}

/** Images pasted or dropped into a form: thumbnails, a Claude-sized copy, and the originals to upload */
export function useImageAttachments(
  onReject?: (message: string) => void,
  /** Another set already holding this image (by hash): its name, so the add is skipped */
  elsewhere?: (hash: string) => string | null,
) {
  const images = ref<PendingImage[]>([])

  /**
   * Adds the image files; resolves to the ones added. With `reuse`, an image that's already here comes
   * back as the existing one (pasted twice into a description: one upload, two references).
   */
  async function add(files: Iterable<File>, { reuse = false } = {}): Promise<PendingImage[]> {
    const added: PendingImage[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      if (images.value.length >= MAX_IMAGES) {
        onReject?.(`Up to ${MAX_IMAGES} images`)
        break
      }
      if (f.size > MAX_BYTES) {
        onReject?.(`${f.name || 'Image'} is over 10 MB`)
        continue
      }
      const data = await toBase64(f)
      const hash = await sha256(data)
      const existing = images.value.find((i) => i.hash === hash)
      if (existing && reuse) {
        added.push(existing)
        continue
      }
      const dupe = existing?.name ?? elsewhere?.(hash)
      if (dupe) {
        onReject?.(`Already added as ${dupe}`)
        continue
      }
      const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
      // Pasted screenshots are all called "image.png": number them
      const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${images.value.length + 1}.${ext}`
      // Unique names: the description refers to images by name
      let unique = name
      for (let n = 2; images.value.some((i) => i.name === unique); n++) unique = name.replace(/(\.[^.]+)?$/, `-${n}$1`)
      const img = { id: crypto.randomUUID(), name: unique, type: f.type, size: f.size, data, url: URL.createObjectURL(f), hash }
      images.value.push(img)
      added.push(img)
    }
    return added
  }
  function remove(id: string) {
    const i = images.value.find((x) => x.id === id)
    if (i) URL.revokeObjectURL(i.url)
    images.value = images.value.filter((x) => x.id !== id)
  }
  function clear() {
    for (const i of images.value) URL.revokeObjectURL(i.url)
    images.value = []
  }
  const forUpload = (): ImageAttachment[] => images.value.map(({ name, type, data }) => ({ name, type, data }))
  const forDraft = () => Promise.all(images.value.map(forClaude))

  /** Paste handler: takes image files (text in the same paste still goes through); resolves to the added images */
  async function onPaste(e: ClipboardEvent, opts: { reuse?: boolean } = {}): Promise<PendingImage[]> {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return []
    if (!e.clipboardData?.getData('text/plain')) e.preventDefault()
    return add(files, opts)
  }

  // Drag and drop: `dragging` shows the drop overlay
  const dragging = ref(false)
  let depth = 0
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
  const dragHandlers = {
    dragenter: (e: DragEvent) => hasFiles(e) && (e.preventDefault(), depth++, (dragging.value = true)),
    dragover: (e: DragEvent) => hasFiles(e) && e.preventDefault(),
    dragleave: (e: DragEvent) => hasFiles(e) && --depth <= 0 && ((depth = 0), (dragging.value = false)),
    drop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      dragging.value = false
      const files = [...(e.dataTransfer?.files ?? [])]
      if (onDrop) onDrop(files, e)
      else add(files)
    },
  }
  let onDrop: ((files: File[], e: DragEvent) => void) | undefined
  /** Decide where dropped files go (default: added here) */
  const whenDropped = (fn: typeof onDrop) => (onDrop = fn)

  return { images, add, remove, clear, forUpload, forDraft, onPaste, dragging, dragHandlers, whenDropped }
}

export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
