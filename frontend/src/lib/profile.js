import { getSupabase } from './supabase'

const galleryBucket = 'application-photos'
const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const allowedImageExtensions = ['jpg', 'jpeg', 'png', 'webp']
const imageExtensionByType = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const maxImageSize = 5 * 1024 * 1024

export async function updateMemberProfile(memberId, accessCode, profile) {
  const client = getSupabase()

  const { data, error } = await client.rpc('update_member_profile', {
    active_member_id: memberId,
    secret_code: accessCode,
    profile_bio: profile.bio || '',
    profile_instagram: profile.instagram || '',
    profile_car_model: profile.car_model || '',
    profile_car_setup: profile.car_setup || '',
    profile_car_specs: profile.car_specs || '',
    profile_car_mods: profile.car_mods || '',
    profile_gallery_urls: profile.gallery_urls || [],
    profile_image_url: profile.image_url || '',
  })

  if (error) {
    throw error
  }

  const member = Array.isArray(data) ? data[0] : data

  if (!member) {
    throw new Error('Perfil nao encontrado.')
  }

  return member
}

export async function uploadMemberGalleryImage(memberId, file) {
  const imageError = validateGalleryImage(file)

  if (imageError) {
    throw new Error(imageError)
  }

  const client = getSupabase()
  const fileName = createGalleryFileName(file)
  const filePath = `member-gallery/${memberId}/${fileName}`

  const { error } = await client.storage
    .from(galleryBucket)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    throw error
  }

  const { data } = client.storage.from(galleryBucket).getPublicUrl(filePath)

  return data.publicUrl
}

export async function uploadMemberVehicleImage(memberId, file) {
  const imageError = validateGalleryImage(file)

  if (imageError) {
    throw new Error(imageError)
  }

  const client = getSupabase()
  const fileName = createGalleryFileName(file)
  const filePath = `member-vehicles/${memberId}/${fileName}`

  const { error } = await client.storage
    .from(galleryBucket)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    throw error
  }

  const { data } = client.storage.from(galleryBucket).getPublicUrl(filePath)

  return data.publicUrl
}

export function validateProfileImage(file) {
  return validateGalleryImage(file)
}

function validateGalleryImage(file) {
  if (!file) return 'Selecione uma imagem.'

  if (!isAllowedGalleryImage(file)) {
    return 'Formato invalido. Use JPG, PNG ou WEBP.'
  }

  if (file.size > maxImageSize) {
    return 'A imagem deve ter no maximo 5MB.'
  }

  return ''
}

function createGalleryFileName(file) {
  const fileExtension = getGalleryFileExtension(file)
  const randomId =
    globalThis.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2)

  return `${Date.now()}-${randomId}.${fileExtension}`
}

function getGalleryFileExtension(file) {
  const fileExtension = file.name
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (allowedImageExtensions.includes(fileExtension)) {
    return fileExtension === 'jpeg' ? 'jpg' : fileExtension
  }

  return imageExtensionByType[file.type] || 'jpg'
}

function isAllowedGalleryImage(file) {
  if (allowedImageTypes.includes(file.type)) return true

  const fileExtension = file.name
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  return allowedImageExtensions.includes(fileExtension)
}
