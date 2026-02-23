export interface CompressOptions {
  maxWidth: number
  maxHeight: number
  quality: number
  maxSizeKB: number
}

export interface CompressResult {
  base64: string
  originalSize: number
  compressedSize: number
  wasCompressed: boolean
}

const DEFAULT_SMALL_OPTIONS: CompressOptions = {
  maxWidth: 128,
  maxHeight: 128,
  quality: 0.8,
  maxSizeKB: 100
}

const DEFAULT_LARGE_OPTIONS: CompressOptions = {
  maxWidth: 800,
  maxHeight: 800,
  quality: 0.7,
  maxSizeKB: 500
}

export function compressImage(
  file: File,
  options: CompressOptions
): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const originalSize = file.size
    const maxSizeBytes = options.maxSizeKB * 1024

    if (originalSize > maxSizeBytes * 3) {
      reject(new Error(`图片文件过大，请选择小于 ${options.maxSizeKB * 3}KB 的图片`))
      return
    }

    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target?.result as string
    }

    reader.onerror = () => {
      reject(new Error('读取图片失败'))
    }

    img.onload = () => {
      let { width, height } = img
      
      if (width > options.maxWidth || height > options.maxHeight) {
        const ratio = Math.min(options.maxWidth / width, options.maxHeight / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      let quality = options.quality
      let base64 = canvas.toDataURL('image/jpeg', quality)

      while (base64.length > maxSizeBytes * 1.37 && quality > 0.1) {
        quality -= 0.1
        base64 = canvas.toDataURL('image/jpeg', quality)
      }

      const compressedSize = Math.round(base64.length * 0.75)

      resolve({
        base64,
        originalSize,
        compressedSize,
        wasCompressed: compressedSize < originalSize
      })
    }

    img.onerror = () => {
      reject(new Error('加载图片失败'))
    }

    reader.readAsDataURL(file)
  })
}

export function compressSmallAvatar(file: File): Promise<CompressResult> {
  return compressImage(file, DEFAULT_SMALL_OPTIONS)
}

export function compressLargeAvatar(file: File): Promise<CompressResult> {
  return compressImage(file, DEFAULT_LARGE_OPTIONS)
}
