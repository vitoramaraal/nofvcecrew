import { useEffect, useRef, useState } from 'react'
import MobileAppLayout from '../../components/members/MobileAppLayout'
import PageTransition from '../../components/PageTransition'
import MemberCard from '../../components/members/MemberCard'
import ImageCropper from '../../components/ImageCropper'
import { fetchMemberProfile } from '../../lib/members'
import {
  updateMemberProfile,
  uploadMemberGalleryImage,
  uploadMemberVehicleImage,
  validateProfileImage,
} from '../../lib/profile'
import {
  getCurrentMember,
  getStoredAccessCode,
  updateStoredMember,
} from '../../utils/auth'
import { exportMemberCardAsPng } from '../../utils/exportMemberCard'

const maxGalleryImages = 6
const vehicleCardPhotoAspect = 420 / 260

function Profile() {
  const [profileMember, setProfileMember] = useState(null)
  const [formData, setFormData] = useState(createProfileForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingGallery, setUploadingGallery] = useState(false)
  const [uploadingVehicle, setUploadingVehicle] = useState(false)
  const [vehicleCropFile, setVehicleCropFile] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
  const [exportError, setExportError] = useState('')
  const cardSvgRef = useRef(null)

  const galleryImages = formData.gallery_urls || []
  const cardMember = profileMember ? { ...profileMember, ...formData } : null

  async function handleExportCard() {
    if (exporting) return

    setExporting(true)
    setExportError('')

    try {
      const fileName = createCardFileName(cardMember)
      await exportMemberCardAsPng(cardSvgRef.current, fileName)
    } catch (error) {
      console.error(error)
      setExportError(
        'Nao foi possivel gerar a carteirinha. Tente novamente ou verifique se as fotos estao acessiveis.',
      )
    }

    setExporting(false)
  }

  function handleFieldChange(event) {
    const { name, value } = event.target

    setFormData((current) => ({
      ...current,
      [name]: formatProfileField(name, value),
    }))

    setProfileError('')
    setProfileSuccess('')
  }

  async function handleGalleryUpload(event) {
    const file = event.target.files[0]

    event.target.value = ''

    if (!file || uploadingGallery) return

    if (galleryImages.length >= maxGalleryImages) {
      setProfileError(`A galeria aceita ate ${maxGalleryImages} fotos.`)
      return
    }

    const currentMember = getCurrentMember()

    if (!currentMember?.id) {
      setProfileError('Sessao de membro invalida.')
      return
    }

    setUploadingGallery(true)
    setProfileError('')
    setProfileSuccess('')

    try {
      const imageUrl = await uploadMemberGalleryImage(currentMember.id, file)

      setFormData((current) => ({
        ...current,
        gallery_urls: [...(current.gallery_urls || []), imageUrl].slice(
          0,
          maxGalleryImages,
        ),
      }))

      setProfileSuccess('Foto adicionada. Salve o perfil para confirmar.')
    } catch (error) {
      console.error(error)
      setProfileError(error?.message || 'Nao foi possivel subir a foto.')
    }

    setUploadingGallery(false)
  }

  function handleVehicleImageChange(event) {
    const file = event.target.files[0]

    event.target.value = ''

    if (!file || uploadingVehicle) return

    const imageError = validateProfileImage(file)

    if (imageError) {
      setProfileError(imageError)
      setProfileSuccess('')
      return
    }

    setProfileError('')
    setProfileSuccess('')
    setVehicleCropFile(file)
  }

  async function handleVehicleCropApply(croppedFile) {
    const currentMember = getCurrentMember()

    if (!currentMember?.id) {
      setProfileError('Sessao de membro invalida.')
      setVehicleCropFile(null)
      return
    }

    setUploadingVehicle(true)
    setProfileError('')
    setProfileSuccess('')

    try {
      const imageUrl = await uploadMemberVehicleImage(
        currentMember.id,
        croppedFile,
      )

      setFormData((current) => ({
        ...current,
        image_url: imageUrl,
      }))

      setProfileSuccess('Foto do veiculo ajustada. Salve o perfil para confirmar.')
      setVehicleCropFile(null)
    } catch (error) {
      console.error(error)
      setProfileError(error?.message || 'Nao foi possivel subir a foto.')
    }

    setUploadingVehicle(false)
  }

  function handleVehicleCropCancel() {
    if (uploadingVehicle) return

    setVehicleCropFile(null)
  }

  function removeGalleryImage(imageUrl) {
    setFormData((current) => ({
      ...current,
      gallery_urls: (current.gallery_urls || []).filter(
        (item) => item !== imageUrl,
      ),
    }))

    setProfileError('')
    setProfileSuccess('Foto removida. Salve o perfil para confirmar.')
  }

  async function handleSaveProfile(event) {
    event.preventDefault()

    if (saving) return

    const currentMember = getCurrentMember()
    const accessCode = getStoredAccessCode()

    if (!currentMember?.id || !accessCode) {
      setProfileError('Sessao de membro invalida. Entre novamente.')
      return
    }

    setSaving(true)
    setProfileError('')
    setProfileSuccess('')

    try {
      const updatedMember = await updateMemberProfile(
        currentMember.id,
        accessCode,
        formData,
      )

      setProfileMember(updatedMember)
      setFormData(createProfileForm(updatedMember))
      updateStoredMember(updatedMember)
      setProfileSuccess('Perfil atualizado.')
    } catch (error) {
      console.error(error)
      setProfileError(error?.message || 'Nao foi possivel salvar o perfil.')
    }

    setSaving(false)
  }

  useEffect(() => {
    let isMounted = true

    async function loadInitialProfile() {
      try {
        const currentMember = getCurrentMember()
        const accessCode = getStoredAccessCode()

        if (!isMounted) return

        if (!currentMember?.id || !accessCode) {
          setProfileMember(null)
          setLoading(false)
          return
        }

        const data = await fetchMemberProfile(currentMember.id, accessCode)

        if (!isMounted) return

        setProfileMember(data)
        setFormData(createProfileForm(data))
      } catch (error) {
        console.error(error)

        if (!isMounted) return

        setProfileMember(null)
      }

      if (isMounted) {
        setLoading(false)
      }
    }

    void loadInitialProfile()

    return () => {
      isMounted = false
    }
  }, [])

  if (loading) {
    return (
      <MobileAppLayout title="Profile">
        <PageTransition>
          <section className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-6 text-sm text-white/40 backdrop-blur-xl">
            Carregando perfil...
          </section>
        </PageTransition>
      </MobileAppLayout>
    )
  }

  if (!profileMember) {
    return (
      <MobileAppLayout title="Profile">
        <PageTransition>
          <section className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-6 text-sm text-white/40 backdrop-blur-xl">
            Nenhum membro aprovado encontrado.
          </section>
        </PageTransition>
      </MobileAppLayout>
    )
  }

  return (
    <MobileAppLayout title="Profile">
      <PageTransition>
        <section>
          <p className="text-[10px] uppercase tracking-[0.45em] text-white/30">
            Carteirinha NFC
          </p>

          <h1 className="mt-3 text-4xl font-black uppercase leading-none text-white">
            Member ID
          </h1>

          <p className="mt-4 text-sm leading-6 text-white/45">
            Identificacao privada da NoFvce Crew, gerada automaticamente para
            cada membro aprovado.
          </p>
        </section>

        <section className="mt-6">
          <MemberCard member={cardMember} svgRef={cardSvgRef} />
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl">
          <button
            type="button"
            onClick={handleExportCard}
            disabled={exporting}
            className="w-full rounded-full border border-white/10 bg-white/10 px-5 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-white/45 transition hover:border-white/20 hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? 'Gerando...' : 'Baixar carteirinha'}
          </button>

          {exportError && (
            <p className="mt-4 text-sm leading-6 text-red-300">
              {exportError}
            </p>
          )}
        </section>

        <form
          onSubmit={handleSaveProfile}
          className="mt-6 space-y-4 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl"
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-white/30">
              Perfil
            </p>

            <h2 className="mt-2 text-3xl font-black uppercase leading-none">
              Garage Bio
            </h2>
          </div>

          <ProfileInput
            label="Instagram"
            name="instagram"
            value={formData.instagram}
            onChange={handleFieldChange}
            placeholder="@instagram"
            maxLength="31"
          />

          <ProfileInput
            label="Carro"
            name="car_model"
            value={formData.car_model}
            onChange={handleFieldChange}
            placeholder="Modelo do carro"
            maxLength="80"
          />

          <section className="rounded-[1.5rem] border border-white/5 bg-black/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/25">
                  Foto do veiculo
                </p>

                <p className="mt-2 text-xs text-white/35">
                  Usada na carteirinha e na garagem
                </p>
              </div>

              <label className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                {uploadingVehicle ? 'Subindo...' : 'Trocar'}
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleVehicleImageChange}
                  disabled={uploadingVehicle}
                  className="hidden"
                />
              </label>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/5 bg-black/60">
              {formData.image_url ? (
                <img
                  src={formData.image_url}
                  alt="Foto do veiculo"
                  className="w-full object-cover"
                  style={{ aspectRatio: vehicleCardPhotoAspect }}
                />
              ) : (
                <div
                  className="flex w-full items-center justify-center text-sm text-white/30"
                  style={{ aspectRatio: vehicleCardPhotoAspect }}
                >
                  Sem foto
                </div>
              )}
            </div>
          </section>

          <ProfileTextarea
            label="Bio"
            name="bio"
            value={formData.bio}
            onChange={handleFieldChange}
            placeholder="Uma bio curta sobre voce e o carro"
            maxLength="500"
          />

          <ProfileTextarea
            label="Setup"
            name="car_setup"
            value={formData.car_setup}
            onChange={handleFieldChange}
            placeholder="Suspensao, rodas, fitment, detalhe principal"
            maxLength="700"
          />

          <ProfileTextarea
            label="Specs"
            name="car_specs"
            value={formData.car_specs}
            onChange={handleFieldChange}
            placeholder="Motor, ano, versao, rodas, pneus"
            maxLength="700"
          />

          <ProfileTextarea
            label="Mods"
            name="car_mods"
            value={formData.car_mods}
            onChange={handleFieldChange}
            placeholder="Lista de modificacoes atuais"
            maxLength="700"
          />

          <section className="rounded-[1.5rem] border border-white/5 bg-black/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/25">
                  Galeria
                </p>

                <p className="mt-2 text-xs text-white/35">
                  {galleryImages.length}/{maxGalleryImages} fotos
                </p>
              </div>

              <label className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                {uploadingGallery ? 'Subindo...' : 'Adicionar'}
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleGalleryUpload}
                  disabled={uploadingGallery}
                  className="hidden"
                />
              </label>
            </div>

            {galleryImages.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {galleryImages.map((imageUrl) => (
                  <div
                    key={imageUrl}
                    className="overflow-hidden rounded-2xl border border-white/5 bg-black/60"
                  >
                    <img
                      src={imageUrl}
                      alt="Foto da galeria"
                      className="aspect-square w-full object-cover"
                    />

                    <button
                      type="button"
                      onClick={() => removeGalleryImage(imageUrl)}
                      className="w-full bg-red-500/10 px-3 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {profileSuccess && (
            <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-300">
              {profileSuccess}
            </p>
          )}

          {profileError && (
            <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-300">
              {profileError}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || uploadingGallery || uploadingVehicle}
            className="w-full rounded-full border border-white/10 bg-white/10 px-5 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-white/45 transition hover:border-white/20 hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Salvando...' : 'Salvar perfil'}
          </button>
        </form>

        {vehicleCropFile && (
          <ImageCropper
            file={vehicleCropFile}
            title="Foto do veiculo"
            aspectRatio={vehicleCardPhotoAspect}
            outputWidth={1260}
            onApply={handleVehicleCropApply}
            onCancel={handleVehicleCropCancel}
          />
        )}
      </PageTransition>
    </MobileAppLayout>
  )
}

function ProfileInput({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/25">
        {label}
      </span>

      <input
        {...props}
        className="w-full rounded-2xl border border-white/5 bg-black/60 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
      />
    </label>
  )
}

function ProfileTextarea({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/25">
        {label}
      </span>

      <textarea
        {...props}
        rows="4"
        className="w-full resize-none rounded-2xl border border-white/5 bg-black/60 px-4 py-4 text-sm leading-6 text-white outline-none placeholder:text-white/25"
      />
    </label>
  )
}

function createProfileForm(member = {}) {
  return {
    instagram: member.instagram || '',
    car_model: member.car_model || '',
    bio: member.bio || '',
    car_setup: member.car_setup || '',
    car_specs: member.car_specs || '',
    car_mods: member.car_mods || '',
    image_url: member.image_url || '',
    gallery_urls: Array.isArray(member.gallery_urls) ? member.gallery_urls : [],
  }
}

function formatProfileField(name, value) {
  const formatters = {
    instagram: formatInstagram,
    car_model: (text) => text.replace(/\s+/g, ' ').slice(0, 80),
    bio: (text) => text.slice(0, 500),
    car_setup: (text) => text.slice(0, 700),
    car_specs: (text) => text.slice(0, 700),
    car_mods: (text) => text.slice(0, 700),
  }

  return formatters[name]?.(value) ?? value
}

function formatInstagram(value) {
  const cleanValue = value
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[^a-z0-9._@]/g, '')
    .replace(/@+/g, '@')

  if (!cleanValue) return ''

  return cleanValue.startsWith('@')
    ? cleanValue.slice(0, 31)
    : `@${cleanValue}`.slice(0, 31)
}

function createCardFileName(member) {
  const memberNumber = member?.member_number || 'nofvce'
  const safeName = memberNumber.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  return `nofvce-card-${safeName}.png`
}

export default Profile
