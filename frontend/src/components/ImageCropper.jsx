import { useEffect, useRef, useState } from 'react'

function ImageCropper({
  file,
  title = 'Ajustar foto',
  aspectRatio = 1,
  outputWidth = 1200,
  onApply,
  onCancel,
}) {
  const [imageReady, setImageReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!file) return undefined

    const imageUrl = URL.createObjectURL(file)
    const image = new Image()
    let active = true

    image.onload = () => {
      if (!active) return

      imageRef.current = image
      setImageReady(true)
    }

    image.onerror = () => {
      if (!active) return

      imageRef.current = null
      setError('Nao foi possivel abrir esta imagem.')
    }

    image.src = imageUrl

    return () => {
      active = false
      URL.revokeObjectURL(imageUrl)
      imageRef.current = null
    }
  }, [file])

  useEffect(() => {
    const image = imageRef.current
    const canvas = canvasRef.current

    if (!imageReady || !image || !canvas) return

    const outputHeight = Math.round(outputWidth / aspectRatio)
    const crop = calculateCrop(image, aspectRatio, zoom, offsetX, offsetY)
    const context = canvas.getContext('2d')

    canvas.width = outputWidth
    canvas.height = outputHeight

    context.clearRect(0, 0, outputWidth, outputHeight)
    context.fillStyle = '#050505'
    context.fillRect(0, 0, outputWidth, outputHeight)
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      outputWidth,
      outputHeight,
    )
  }, [aspectRatio, imageReady, offsetX, offsetY, outputWidth, zoom])

  async function handleApply() {
    const image = imageRef.current

    if (!file || !image || applying) return

    setApplying(true)
    setError('')

    try {
      const croppedFile = await createCroppedFile(
        image,
        file,
        aspectRatio,
        zoom,
        offsetX,
        offsetY,
        outputWidth,
      )

      await onApply(croppedFile)
    } catch (cropError) {
      console.error(cropError)
      setError('Nao foi possivel cortar esta imagem.')
    }

    if (isMountedRef.current) {
      setApplying(false)
    }
  }

  if (!file) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-4 py-6 backdrop-blur-xl">
      <section className="max-h-full w-full max-w-md overflow-y-auto rounded-[1.5rem] border border-white/10 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-white/30">
              Preview
            </p>

            <h2 className="mt-2 text-2xl font-black uppercase leading-none text-white">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/10 text-sm font-black text-white/45 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Fechar corte"
          >
            X
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.25rem] border border-white/10 bg-black">
          {imageReady ? (
            <canvas ref={canvasRef} className="block h-auto w-full" />
          ) : (
            <div
              className="flex w-full items-center justify-center text-sm text-white/35"
              style={{ aspectRatio }}
            >
              Carregando imagem...
            </div>
          )}
        </div>

        <div className="mt-5 space-y-4">
          <CropSlider
            label="Zoom"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(value) => setZoom(Number(value))}
          />

          <CropSlider
            label="Horizontal"
            min="-100"
            max="100"
            step="1"
            value={offsetX}
            onChange={(value) => setOffsetX(Number(value))}
          />

          <CropSlider
            label="Vertical"
            min="-100"
            max="100"
            step="1"
            value={offsetY}
            onChange={(value) => setOffsetY(Number(value))}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={!imageReady || applying}
            className="rounded-full border border-white/10 bg-white/15 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 transition hover:border-white/25 hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applying ? 'Aplicando...' : 'Aplicar'}
          </button>
        </div>
      </section>
    </div>
  )
}

function CropSlider({ label, value, onChange, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/25">
        {label}
      </span>

      <input
        {...props}
        type="range"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-white"
      />
    </label>
  )
}

function calculateCrop(image, aspectRatio, zoom, offsetX, offsetY) {
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  const imageAspect = imageWidth / imageHeight
  const safeZoom = Math.max(1, Number(zoom) || 1)

  let baseWidth
  let baseHeight

  if (imageAspect > aspectRatio) {
    baseHeight = imageHeight
    baseWidth = imageHeight * aspectRatio
  } else {
    baseWidth = imageWidth
    baseHeight = imageWidth / aspectRatio
  }

  const cropWidth = Math.min(imageWidth, baseWidth / safeZoom)
  const cropHeight = Math.min(imageHeight, baseHeight / safeZoom)
  const maxOffsetX = Math.max(0, (imageWidth - cropWidth) / 2)
  const maxOffsetY = Math.max(0, (imageHeight - cropHeight) / 2)
  const centerX = imageWidth / 2 + maxOffsetX * (offsetX / 100)
  const centerY = imageHeight / 2 + maxOffsetY * (offsetY / 100)

  return {
    x: clamp(centerX - cropWidth / 2, 0, imageWidth - cropWidth),
    y: clamp(centerY - cropHeight / 2, 0, imageHeight - cropHeight),
    width: cropWidth,
    height: cropHeight,
  }
}

function createCroppedFile(
  image,
  sourceFile,
  aspectRatio,
  zoom,
  offsetX,
  offsetY,
  outputWidth,
) {
  const outputHeight = Math.round(outputWidth / aspectRatio)
  const crop = calculateCrop(image, aspectRatio, zoom, offsetX, offsetY)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = outputWidth
  canvas.height = outputHeight

  context.fillStyle = '#050505'
  context.fillRect(0, 0, outputWidth, outputHeight)
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputWidth,
    outputHeight,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed.'))
          return
        }

        const fileName = `${createSafeBaseName(sourceFile.name)}-crop.jpg`

        resolve(
          new File([blob], fileName, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }),
        )
      },
      'image/jpeg',
      0.9,
    )
  })
}

function createSafeBaseName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return safeBaseName || 'foto'
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export default ImageCropper
