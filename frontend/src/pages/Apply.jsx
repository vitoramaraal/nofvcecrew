import { useState } from 'react'
import Background from '../components/Background'
import ImageCropper from '../components/ImageCropper'
import { getSupabase } from '../lib/supabase'

const memberCardPhotoAspect = 330 / 410
const vehicleCardPhotoAspect = 420 / 260

function Apply() {
  const [carPreview, setCarPreview] = useState(null)
  const [memberPreview, setMemberPreview] = useState(null)
  const [cropTarget, setCropTarget] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [carFile, setCarFile] = useState(null)
  const [memberFile, setMemberFile] = useState(null)

  const [formData, setFormData] = useState({
    full_name: '',
    instagram: '',
    whatsapp: '',
    car_model: '',
    message: '',
  })

  function handleChange(event) {
    const { name, value } = event.target
    const nextValue = formatFieldValue(name, value)

    setFormData((current) => ({
      ...current,
      [name]: nextValue,
    }))

    if (error) {
      setError('')
    }
  }

  function validateImage(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    const maxSize = 5 * 1024 * 1024

    if (!file) return 'Selecione uma imagem.'

    if (!allowedTypes.includes(file.type)) {
      return 'Formato invalido. Use JPG, PNG ou WEBP.'
    }

    if (file.size > maxSize) {
      return 'A imagem deve ter no maximo 5MB.'
    }

    return ''
  }

  function handleMemberImageChange(event) {
    const file = event.target.files[0]
    event.target.value = ''

    if (!file) {
      setMemberPreview(null)
      setMemberFile(null)
      setError('')
      return
    }

    const imageError = validateImage(file)

    if (imageError) {
      setError(imageError)
      setMemberPreview(null)
      setMemberFile(null)
      event.target.value = ''
      return
    }

    setError('')
    setCropTarget({
      type: 'member',
      file,
    })
  }

  function handleCarImageChange(event) {
    const file = event.target.files[0]
    event.target.value = ''

    if (!file) {
      setCarPreview(null)
      setCarFile(null)
      setError('')
      return
    }

    const imageError = validateImage(file)

    if (imageError) {
      setError(imageError)
      setCarPreview(null)
      setCarFile(null)
      event.target.value = ''
      return
    }

    setError('')
    setCropTarget({
      type: 'car',
      file,
    })
  }

  function handleCropCancel() {
    setCropTarget(null)
  }

  function handleCropApply(croppedFile) {
    if (!cropTarget) return

    const previewUrl = URL.createObjectURL(croppedFile)

    if (cropTarget.type === 'member') {
      setMemberFile(croppedFile)
      setMemberPreview(previewUrl)
    } else {
      setCarFile(croppedFile)
      setCarPreview(previewUrl)
    }

    setError('')
    setCropTarget(null)
  }

  async function uploadPhoto(file, folder) {
    const client = getSupabase()
    const fileExtension = file.name.split('.').pop()
    const randomId =
      globalThis.crypto?.randomUUID?.() ||
      Math.random().toString(36).slice(2)
    const fileName = `${folder}-${Date.now()}-${randomId}.${fileExtension}`
    const filePath = `${folder}/${fileName}`

    const { error: uploadError } = await client.storage
      .from('application-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      throw uploadError
    }

    const { data } = client.storage
      .from('application-photos')
      .getPublicUrl(filePath)

    return {
      url: data.publicUrl,
      path: filePath,
    }
  }

  async function saveApplication(applicationPayload) {
    const client = getSupabase()

    const { data, error: rpcError } = await client.rpc('create_application', {
      candidate_full_name: applicationPayload.full_name,
      candidate_instagram: applicationPayload.instagram,
      candidate_whatsapp: applicationPayload.whatsapp,
      candidate_car_model: applicationPayload.car_model,
      candidate_message: applicationPayload.message || '',
      candidate_image_name: applicationPayload.image_name,
      candidate_image_url: applicationPayload.image_url,
      candidate_image_path: applicationPayload.image_path,
      candidate_member_photo_url: applicationPayload.member_photo_url,
      candidate_member_photo_path: applicationPayload.member_photo_path,
      candidate_identity_rule_confirmed:
        applicationPayload.identity_rule_confirmed,
    })

    if (!rpcError) {
      if (!data) {
        throw new Error('O banco nao confirmou a candidatura.')
      }

      return data
    }

    const isMissingRpc =
      rpcError.message?.includes('create_application') ||
      rpcError.message?.includes('schema cache')

    if (!isMissingRpc) {
      throw rpcError
    }

    const { error: insertError } = await client
      .from('applications')
      .insert([applicationPayload])

    if (insertError) {
      throw insertError
    }

    return 'legacy-insert'
  }

  async function sendEmailNotification(data) {
    const emailFormData = new FormData()

    emailFormData.append('_subject', 'Nova inscricao - NoFvce Crew')
    emailFormData.append('_captcha', 'false')
    emailFormData.append('_template', 'table')
    emailFormData.append('Nome', data.full_name)
    emailFormData.append('Instagram', data.instagram)
    emailFormData.append('WhatsApp', data.whatsapp)
    emailFormData.append('Carro', data.car_model)
    emailFormData.append('Mensagem', data.message || '-')
    emailFormData.append('Foto do membro', data.member_photo_url || '-')
    emailFormData.append('Foto do carro', data.image_url || '-')
    emailFormData.append(
      'Regra de identidade',
      data.identity_rule_confirmed
        ? 'Blur aplicado automaticamente'
        : 'Nao confirmada',
    )

    try {
      await fetch(
        'https://formsubmit.co/ajax/applynewmembersnofvcecrew@gmail.com',
        {
          method: 'POST',
          body: emailFormData,
        },
      )
    } catch (emailError) {
      console.error(emailError)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (loading) return

    setLoading(true)
    setError('')
    setSuccess(false)

    try {
      const validationError = validateForm(formData)

      if (validationError) {
        setError(validationError)
        setLoading(false)
        return
      }

      if (!memberFile) {
        setError('Envie uma foto sua para a carteirinha.')
        setLoading(false)
        return
      }

      if (!carFile) {
        setError('Envie uma foto do carro.')
        setLoading(false)
        return
      }

      const memberImageError = validateImage(memberFile)
      const carImageError = validateImage(carFile)

      if (memberImageError || carImageError) {
        setError(memberImageError || carImageError)
        setLoading(false)
        return
      }

      const memberPhoto = await uploadPhoto(memberFile, 'member-photos')
      const carPhoto = await uploadPhoto(carFile, 'applications')

      const applicationPayload = {
        ...formData,
        car_setup: null,
        image_name: carFile.name,
        image_url: carPhoto.url,
        image_path: carPhoto.path,
        member_photo_url: memberPhoto.url,
        member_photo_path: memberPhoto.path,
        identity_rule_confirmed: true,
        status: 'pending',
      }

      await saveApplication(applicationPayload)
      await sendEmailNotification(applicationPayload)

      setSuccess(true)
      setFormData({
        full_name: '',
        instagram: '',
        whatsapp: '',
        car_model: '',
        message: '',
      })
      setCarPreview(null)
      setMemberPreview(null)
      setCarFile(null)
      setMemberFile(null)

      event.target.reset()
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Erro inesperado ao enviar aplicacao.')
    }

    setLoading(false)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <Background />

      <header className="relative z-20 flex w-full items-center justify-between border-b border-white/5 px-6 py-4">
        <a
          href="/"
          className="text-[10px] font-bold uppercase tracking-[0.45em] text-white/35 transition hover:text-white"
        >
          NOFVCE
        </a>

        <a
          href="/members/login"
          className="text-[10px] uppercase tracking-[0.35em] text-white/35 transition hover:text-white"
        >
          Members
        </a>
      </header>

      <section className="relative z-10 mx-auto max-w-md px-6 py-10">
        <p className="text-[10px] uppercase tracking-[0.45em] text-white/30">
          Application
        </p>

        <h1 className="mt-4 text-5xl font-black uppercase leading-none">
          Enter the Crew
        </h1>

        <p className="mt-5 text-sm leading-6 text-white/45">
          Envie seus dados, uma foto sua para a carteirinha e uma foto do
          carro para analise da NoFvce Crew. O blur de identidade e aplicado na
          foto da carteirinha antes do envio.
        </p>

        {success && (
          <div className="mt-6 rounded-[1.5rem] border border-emerald-500/20 bg-emerald-500/10 px-5 py-5">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">
              Aplicacao enviada
            </p>

            <p className="mt-2 text-sm text-emerald-100/70">
              Sua candidatura foi salva na plataforma e enviada para analise.
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          encType="multipart/form-data"
          className="mt-8 space-y-4 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl"
        >
          <input
            name="full_name"
            type="text"
            required
            value={formData.full_name}
            onChange={handleChange}
            placeholder="Seu nome"
            maxLength="80"
            className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
          />

          <input
            name="instagram"
            type="text"
            required
            value={formData.instagram}
            onChange={handleChange}
            placeholder="@instagram"
            maxLength="31"
            className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
          />

          <input
            name="whatsapp"
            type="tel"
            inputMode="numeric"
            required
            value={formData.whatsapp}
            onChange={handleChange}
            placeholder="(11) 99999-9999"
            maxLength="15"
            className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
          />

          <input
            name="car_model"
            type="text"
            required
            value={formData.car_model}
            onChange={handleChange}
            placeholder="Modelo do carro"
            maxLength="80"
            className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
          />

          <textarea
            name="message"
            rows="4"
            value={formData.message}
            onChange={handleChange}
            placeholder="Por que quer entrar para a NoFvce?"
            maxLength="500"
            className="w-full resize-none rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
          />

          <ImageInput
            title="Foto para carteirinha"
            description="Escolha a foto; o app aplica o blur de identidade"
            name="member_photo"
            onChange={handleMemberImageChange}
          />

          {memberPreview && !error && (
            <PreviewImage
              src={memberPreview}
              label="Preview da foto do membro"
              aspectRatio={memberCardPhotoAspect}
            />
          )}

          <IdentityRuleNotice />

          <ImageInput
            title="Foto do carro"
            description="Escolha a foto e ajuste o corte do veiculo"
            name="car_photo"
            onChange={handleCarImageChange}
          />

          {carPreview && !error && (
            <PreviewImage
              src={carPreview}
              label="Preview do carro"
              aspectRatio={vehicleCardPhotoAspect}
            />
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full border border-white/10 bg-white/10 px-6 py-4 text-xs font-black uppercase tracking-[0.32em] text-white/40 backdrop-blur-xl transition hover:border-white/20 hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Enviando...' : 'Enviar aplicacao'}
          </button>
        </form>
      </section>

      {cropTarget?.file && (
        <ImageCropper
          file={cropTarget.file}
          title={
            cropTarget.type === 'member'
              ? 'Foto da carteirinha'
              : 'Foto do veiculo'
          }
          aspectRatio={
            cropTarget.type === 'member'
              ? memberCardPhotoAspect
              : vehicleCardPhotoAspect
          }
          outputWidth={cropTarget.type === 'member' ? 990 : 1260}
          privacyBlur={cropTarget.type === 'member'}
          privacyBlurDescription="Posicione o blur sobre o rosto ou area de identidade. Ele fica gravado na foto enviada."
          onApply={handleCropApply}
          onCancel={handleCropCancel}
        />
      )}
    </main>
  )
}

function ImageInput({ title, description, name, onChange }) {
  return (
    <label className="block rounded-2xl border border-dashed border-white/10 bg-black/50 p-5 text-center">
      <span className="block text-xs font-black uppercase tracking-[0.25em] text-white/40">
        {title}
      </span>

      <span className="mt-2 block text-[11px] uppercase tracking-[0.2em] text-white/25">
        {description}
      </span>

      <input
        name={name}
        type="file"
        accept="image/png, image/jpeg, image/webp"
        onChange={onChange}
        className="mt-4 w-full text-xs text-white/40 file:mr-4 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:text-white/60"
      />
    </label>
  )
}

function IdentityRuleNotice() {
  return (
    <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-300 bg-emerald-300 text-[12px] font-black text-black">
        OK
      </span>

      <span className="text-sm leading-6 text-white/50">
        A plataforma aplica um blur de identidade na foto da carteirinha antes
        de salvar a candidatura. Ajuste a altura e o tamanho do blur no preview
        para cobrir o rosto ou qualquer area sensivel.
      </span>
    </div>
  )
}

function PreviewImage({ src, label, aspectRatio }) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-white/5 bg-black/60">
      <img
        src={src}
        alt={label}
        className="w-full object-cover"
        style={{ aspectRatio }}
      />

      <div className="p-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
          {label}
        </p>
      </div>
    </div>
  )
}

function formatFieldValue(name, value) {
  const formatters = {
    full_name: formatFullName,
    instagram: formatInstagram,
    whatsapp: formatWhatsApp,
    car_model: formatCarModel,
    message: limitMessage,
  }

  return formatters[name]?.(value) ?? value
}

function formatFullName(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[0-9]/g, '')
    .slice(0, 80)
}

function formatInstagram(value) {
  const cleanValue = value
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[^a-z0-9._@]/g, '')
    .replace(/@+/g, '@')
    .replace(/^([^@])/, '@$1')

  return cleanValue.startsWith('@')
    ? cleanValue.slice(0, 31)
    : `@${cleanValue}`.slice(0, 31)
}

function formatWhatsApp(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)

  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function formatCarModel(value) {
  return value.replace(/\s+/g, ' ').slice(0, 80)
}

function limitMessage(value) {
  return value.slice(0, 500)
}

function validateForm(data) {
  const fullName = data.full_name.trim()
  const instagram = data.instagram.trim()
  const whatsappDigits = data.whatsapp.replace(/\D/g, '')
  const carModel = data.car_model.trim()

  if (!fullName || !instagram || !data.whatsapp || !carModel) {
    return 'Preencha todos os campos obrigatorios.'
  }

  if (fullName.length < 3) {
    return 'Informe um nome com pelo menos 3 caracteres.'
  }

  if (!/^@[a-z0-9._]{2,30}$/.test(instagram)) {
    return 'Informe um Instagram valido, exemplo: @nofvcecrew.'
  }

  if (![10, 11].includes(whatsappDigits.length)) {
    return 'Informe um WhatsApp valido com DDD.'
  }

  if (carModel.length < 2) {
    return 'Informe o modelo do carro.'
  }

  return ''
}

export default Apply
