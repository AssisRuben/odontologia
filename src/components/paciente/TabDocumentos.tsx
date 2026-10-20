'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, FileText, Image, File, X, Download, Plus, AlertCircle } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'

interface Document {
  id: string
  patient_id: string
  name: string
  file_url: string
  file_type: string | null
  size_bytes: number | null
  category: string
  created_at: string
}

interface PendingFile {
  localId: string
  file: File
  thumbnail: string | null  // data URL for images, null for PDFs (PdfThumb handles them)
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  errorMsg: string
}

const CATEGORIES = [
  { value: 'todos', label: 'Todos' },
  { value: 'rx', label: 'Radiografia' },
  { value: 'foto', label: 'Foto' },
  { value: 'documento', label: 'Documento' },
  { value: 'outros', label: 'Outros' },
]

interface Props {
  patientId: string
  clinicId: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getFileIcon(type: string | null) {
  if (!type) return File
  if (type.startsWith('image/')) return Image
  if (type === 'application/pdf') return FileText
  return File
}

// ─── PDF.js setup ────────────────────────────────────────────────────────────

let pdfJsReady = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPdfJs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfJsReady) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
    pdfJsReady = true
  }
  return pdfjs
}

// ─── Image thumbnail (canvas resize) ─────────────────────────────────────────

async function createImgThumbnail(file: File): Promise<string> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      const maxW = 400, maxH = 300
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve('') }
    img.src = url
  })
}

// ─── PdfThumb ─────────────────────────────────────────────────────────────────

function PdfThumb({ src }: { src: File | string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const pdfjs = await getPdfJs()
        const docSrc = typeof src === 'string'
          ? { url: src }
          : { data: await (src as File).arrayBuffer() }
        const pdf = await pdfjs.getDocument(docSrc).promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return

        const vp = page.getViewport({ scale: 1 })
        const scale = Math.min(240 / vp.width, 160 / vp.height)
        const viewport = page.getViewport({ scale })
        canvas.width  = viewport.width
        canvas.height = viewport.height

        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
        if (!cancelled) setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    render()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'error') return <FileText className="w-8 h-8 text-[#9CA3AF]" />

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#F0F0EE] relative">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{ opacity: state === 'ready' ? 1 : 0, transition: 'opacity 0.2s' }}
      />
    </div>
  )
}

// ─── Circular upload progress ─────────────────────────────────────────────────

function CircularProgress({ pct, size = 36 }: { pct: number; size?: number }) {
  const r = size * 0.35
  const cx = size / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct / 100)
  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <svg style={{ width: size, height: size }} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={size * 0.12} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="white" strokeWidth={size * 0.12}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.15s ease' }}
        />
      </svg>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TabDocumentos({ patientId, clinicId }: Props) {
  const [docs, setDocs]               = useState<Document[]>([])
  const [loading, setLoading]         = useState(true)
  const [category, setCategory]       = useState('todos')
  const [deletingId, setDeletingId]   = useState<string | null>(null)
  const [preview, setPreview]         = useState<Document | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadCat = category === 'todos' ? 'outros' : category

  async function load() {
    const supabase = createClient()
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (data) setDocs(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (fileInputRef.current) fileInputRef.current.value = ''

    const initial: PendingFile[] = files.map(f => ({
      localId: `${Date.now()}-${Math.random()}`,
      file: f,
      thumbnail: null,
      progress: 0,
      status: 'pending',
      errorMsg: '',
    }))
    setPendingFiles(prev => [...prev, ...initial])

    // Generate reduced-res thumbnail for images in background
    for (const pf of initial) {
      if (pf.file.type.startsWith('image/')) {
        const thumb = await createImgThumbnail(pf.file)
        if (thumb) {
          setPendingFiles(prev =>
            prev.map(p => p.localId === pf.localId ? { ...p, thumbnail: thumb } : p)
          )
        }
      }
    }
  }

  function removePending(localId: string) {
    setPendingFiles(prev => prev.filter(p => p.localId !== localId))
  }

  async function handleUpload() {
    const toUpload = pendingFiles.filter(p => p.status === 'pending')
    if (!toUpload.length) return
    setUploading(true)
    const supabase = createClient()

    for (const pending of toUpload) {
      setPendingFiles(prev => prev.map(p =>
        p.localId === pending.localId ? { ...p, status: 'uploading', progress: 0 } : p
      ))

      const timer = setInterval(() => {
        setPendingFiles(prev => prev.map(p => {
          if (p.localId !== pending.localId || p.progress >= 85) return p
          return { ...p, progress: Math.min(85, p.progress + Math.floor(Math.random() * 7) + 2) }
        }))
      }, 160)

      const ext = pending.file.name.split('.').pop() || 'bin'
      const path = `${clinicId}/${patientId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const contentType = pending.file.type || 'application/octet-stream'

      const { data: upload, error: upErr } = await supabase.storage
        .from('anneOdonto')
        .upload(path, pending.file, { contentType })

      clearInterval(timer)

      if (upErr) {
        setPendingFiles(prev => prev.map(p =>
          p.localId === pending.localId ? { ...p, status: 'error', errorMsg: upErr.message, progress: 0 } : p
        ))
        continue
      }
      if (!upload) continue

      const { data: { publicUrl } } = supabase.storage.from('anneOdonto').getPublicUrl(path)

      const { error: insertErr } = await supabase.from('documents').insert({
        clinic_id: clinicId,
        patient_id: patientId,
        name: pending.file.name,
        file_url: publicUrl,
        file_type: pending.file.type || null,
        size_bytes: pending.file.size,
        category: uploadCat,
      })

      if (insertErr) {
        setPendingFiles(prev => prev.map(p =>
          p.localId === pending.localId ? { ...p, status: 'error', errorMsg: insertErr.message, progress: 0 } : p
        ))
        continue
      }

      setPendingFiles(prev => prev.map(p =>
        p.localId === pending.localId ? { ...p, progress: 100 } : p
      ))
      await new Promise(r => setTimeout(r, 400))
      setPendingFiles(prev => prev.filter(p => p.localId !== pending.localId))
    }

    setUploading(false)
    load()
  }

  async function handleDelete(doc: Document) {
    setDeletingId(doc.id)
    const supabase = createClient()
    const url = new URL(doc.file_url)
    const storagePath = url.pathname.split('/storage/v1/object/public/anneOdonto/')[1]
    if (storagePath) {
      await supabase.storage.from('anneOdonto').remove([storagePath])
    }
    await supabase.from('documents').delete().eq('id', doc.id)
    setDeletingId(null)
    load()
  }

  const filtered = category === 'todos' ? docs : docs.filter(d => d.category === category)
  const pendingCount = pendingFiles.filter(p => p.status === 'pending').length

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 bg-white border border-[#E5E7EB] rounded-lg p-1 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCategory(c.value)}
              className={`px-3 h-7 rounded-md text-xs font-medium transition-colors ${
                category === c.value ? 'bg-[#3B82F6] text-white' : 'text-[#6B7280] hover:bg-[#F3F4F6]'
              }`}>
              {c.label}
            </button>
          ))}
        </div>
        <input ref={fileInputRef} type="file" multiple
          accept="image/*,.pdf,.doc,.docx"
          className="hidden" onChange={handleFileSelect} />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-3 h-9 border border-[#E5E7EB] bg-white text-[#374151] text-xs font-medium rounded-lg hover:bg-[#F3F4F6] transition-colors">
          <Plus className="w-3.5 h-3.5" /> Selecionar
        </button>
        {pendingCount > 0 && (
          <button onClick={handleUpload} disabled={uploading}
            className="ml-auto flex items-center gap-1.5 px-3 h-8 bg-[#3B82F6] text-white text-xs font-medium rounded-lg hover:bg-[#2563EB] transition-colors disabled:opacity-60">
            <Upload className="w-3.5 h-3.5" />
            Enviar {pendingCount} arquivo{pendingCount > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && pendingFiles.length === 0 && (
        <div
          className="bg-white rounded-xl border border-dashed border-[#E5E7EB] flex flex-col items-center justify-center h-28 gap-2 cursor-pointer hover:border-[#3B82F6] transition-colors mb-3"
          onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-6 h-6 text-[#D1D5DB]" />
          <p className="text-sm text-[#6B7280]">Clique para adicionar arquivos</p>
          <p className="text-xs text-[#9CA3AF]">Imagens, PDFs e documentos</p>
        </div>
      )}

      {/* Grid */}
      {(filtered.length > 0 || pendingFiles.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">

          {/* Pending cards */}
          {pendingFiles.map(pending => {
            const isPdf      = pending.file.type === 'application/pdf'
            const isImage    = pending.file.type.startsWith('image/')
            const Icon       = getFileIcon(pending.file.type)
            const isUploading = pending.status === 'uploading'
            const isError    = pending.status === 'error'

            return (
              <div key={pending.localId}
                className={`bg-white rounded-xl border overflow-hidden ${
                  isError ? 'border-red-300' : 'border-[#3B82F6] border-dashed'
                }`}>
                <div className="h-24 overflow-hidden relative flex items-center justify-center bg-[#F9FAFB]">
                  {isPdf ? (
                    <PdfThumb src={pending.file} />
                  ) : isImage && pending.thumbnail ? (
                    <img src={pending.thumbnail} alt={pending.file.name} className="w-full h-full object-cover" />
                  ) : isImage ? (
                    /* while thumbnail is being generated */
                    <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Icon className="w-8 h-8 text-[#9CA3AF]" />
                  )}

                  {/* Upload progress overlay */}
                  {isUploading && (
                    <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1">
                      <CircularProgress pct={pending.progress} size={36} />
                      <span className="text-white text-xs font-semibold">{pending.progress}%</span>
                    </div>
                  )}
                  {isError && (
                    <div className="absolute inset-0 bg-red-500/60 flex items-center justify-center">
                      <AlertCircle className="w-7 h-7 text-white" />
                    </div>
                  )}
                  {pending.status === 'pending' && (
                    <button onClick={() => removePending(pending.localId)}
                      className="absolute top-1 right-1 p-0.5 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-[#111827] truncate">{pending.file.name}</p>
                  <p className={`text-xs mt-0.5 truncate ${isError ? 'text-red-500' : 'text-[#9CA3AF]'}`}>
                    {isError ? pending.errorMsg : formatBytes(pending.file.size)}
                  </p>
                </div>
              </div>
            )
          })}

          {/* Uploaded docs */}
          {filtered.map(doc => {
            const isPdf   = doc.file_type === 'application/pdf'
            const isImage = doc.file_type?.startsWith('image/')
            const Icon    = getFileIcon(doc.file_type)
            return (
              <div key={doc.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden group">
                <div
                  className="h-24 overflow-hidden flex items-center justify-center cursor-pointer relative bg-[#F9FAFB]"
                  onClick={() => setPreview(doc)}>
                  {isPdf ? (
                    <PdfThumb src={doc.file_url} />
                  ) : isImage ? (
                    <img src={doc.file_url} alt={doc.name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-8 h-8 text-[#9CA3AF]" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-[#111827] truncate">{doc.name}</p>
                  <p className="text-xs text-[#9CA3AF] mt-0.5 truncate">
                    {format(parseISO(doc.created_at), 'd MMM yyyy', { locale: ptBR })}
                    {doc.size_bytes ? ` · ${formatBytes(doc.size_bytes)}` : ''}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 h-6 rounded-md border border-[#E5E7EB] text-xs text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                      <Download className="w-3 h-3" /> Baixar
                    </a>
                    <button onClick={() => handleDelete(doc)} disabled={deletingId === doc.id}
                      className="p-1.5 rounded-md text-[#9CA3AF] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Add more */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-white rounded-xl border border-dashed border-[#E5E7EB] flex flex-col items-center justify-center gap-1.5 min-h-[108px] hover:border-[#3B82F6] hover:text-[#3B82F6] text-[#D1D5DB] transition-colors">
            <Plus className="w-5 h-5" />
            <span className="text-xs font-medium">Adicionar</span>
          </button>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80"
          onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
          {preview.file_type?.startsWith('image/') ? (
            <img src={preview.file_url} alt={preview.name}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
              onClick={e => e.stopPropagation()} />
          ) : preview.file_type === 'application/pdf' ? (
            <iframe
              src={preview.file_url}
              className="w-[90vw] h-[90vh] rounded-lg bg-white"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            />
          ) : (
            <div className="bg-white rounded-xl p-8 flex flex-col items-center gap-4"
              onClick={e => e.stopPropagation()}>
              <FileText className="w-16 h-16 text-[#6B7280]" />
              <p className="text-sm font-medium text-[#111827]">{preview.name}</p>
              <a href={preview.file_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 h-10 bg-[#3B82F6] text-white text-sm font-medium rounded-lg hover:bg-[#2563EB]">
                <Download className="w-4 h-4" /> Abrir arquivo
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
