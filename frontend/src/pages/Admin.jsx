import { useCallback, useEffect, useState } from 'react'
import EventCheckInScanner from '../components/admin/EventCheckInScanner'
import Background from '../components/Background'
import MemberCard from '../components/members/MemberCard'
import * as adminActions from '../lib/admin'
import {
  enableAdminPushNotifications,
  getAdminPushPermission,
  isAdminPushConfigured,
  isAdminPushSupported,
} from '../lib/adminPush'
import { getSupabase } from '../lib/supabase'

const adminRoles = ['founder', 'admin', 'moderator', 'member']
const panelRoles = ['founder', 'admin', 'moderator']
const managerRoles = ['founder', 'admin']
const eventStatuses = ['draft', 'open', 'closed', 'completed', 'cancelled']

function createWhatsAppUrl(member) {
  const phone = normalizePhone(member.whatsapp)

  if (!phone || !member.access_code) return ''

  const message = [
    `Salve, ${member.full_name}.`,
    '',
    'Sua entrada na NoFvce Crew foi aprovada.',
    `Codigo secreto: ${member.access_code}`,
    '',
    'Use esse codigo na area de membros. Nao compartilhe.',
  ].join('\n')

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '')

  if (!digits) return ''
  if (digits.startsWith('55')) return digits

  return `55${digits}`
}

function Admin() {
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
  })
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [applications, setApplications] = useState([])
  const [members, setMembers] = useState([])
  const [events, setEvents] = useState([])
  const [eventRsvps, setEventRsvps] = useState([])
  const [feedPosts, setFeedPosts] = useState([])
  const [feedComments, setFeedComments] = useState([])
  const [chatMessages, setChatMessages] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [adminRole, setAdminRole] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [applicationAlert, setApplicationAlert] = useState(null)
  const [notificationPermission, setNotificationPermission] = useState(
    getAdminPushPermission(),
  )
  const [realtimeStatus, setRealtimeStatus] = useState('idle')
  const [activeAdminSection, setActiveAdminSection] = useState('applications')
  const [applicationStatusFilter, setApplicationStatusFilter] =
    useState('pending')
  const [expandedMemberId, setExpandedMemberId] = useState('')
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    location: '',
    starts_at: '',
    status: 'open',
    capacity: '',
  })

  const isUnlocked = Boolean(session)
  const pending = applications.filter((item) => item.status === 'pending').length
  const approved = applications.filter((item) => item.status === 'approved').length
  const rejected = applications.filter((item) => item.status === 'rejected').length
  const visibleApplications =
    applicationStatusFilter === 'all'
      ? applications
      : applications.filter((item) => item.status === applicationStatusFilter)
  const canReviewApplications = panelRoles.includes(adminRole)
  const canManageMembers = managerRoles.includes(adminRole)
  const canManageEvents = canManageMembers
  const canViewAuditLogs = canManageMembers
  const moderationCount =
    feedPosts.length + feedComments.length + chatMessages.length

  const notifyNewApplication = useCallback(
    (application) => {
      const applicantName = application?.full_name || 'Novo candidato'
      const carModel = application?.car_model || 'Carro nao informado'

      setApplicationAlert({
        id: application?.id || `${Date.now()}`,
        fullName: applicantName,
        carModel,
      })

      if (
        notificationPermission === 'granted' &&
        !isAdminPushConfigured() &&
        typeof window !== 'undefined' &&
        'Notification' in window
      ) {
        const browserNotification = new window.Notification(
          'Nova candidatura',
          {
            body: `${applicantName} - ${carModel}`,
            tag: `application-${application?.id || Date.now()}`,
          },
        )

        browserNotification.onclick = () => {
          window.focus()
          setActiveAdminSection('applications')
          setApplicationStatusFilter('pending')
        }
      }
    },
    [notificationPermission],
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const client = getSupabase()
      const { data: role, error: adminError } = await client.rpc(
        'current_admin_role',
      )

      if (adminError) {
        throw adminError
      }

      if (!panelRoles.includes(role)) {
        setApplications([])
        setMembers([])
        setEvents([])
        setEventRsvps([])
        setFeedPosts([])
        setFeedComments([])
        setChatMessages([])
        setAuditLogs([])
        setAdminRole('')
        setRealtimeStatus('idle')
        setError(
          'Usuario autenticado, mas ainda nao liberado em public.admin_users.',
        )
        return
      }

      setAdminRole(role)

      const [
        { data: applicationsData, error: applicationsError },
        { data: membersData, error: membersError },
      ] = await Promise.all([
        client
          .from('applications')
          .select('*')
          .order('created_at', { ascending: false }),
        client
          .from('members')
          .select('*')
          .order('created_at', { ascending: false }),
      ])

      if (applicationsError) {
        throw applicationsError
      }

      if (membersError) {
        throw membersError
      }

      setApplications(applicationsData || [])
      setMembers(membersData || [])

      const [
        { data: eventsData, error: eventsError },
        { data: eventRsvpsData, error: eventRsvpsError },
      ] = await Promise.all([
        client
          .from('crew_events')
          .select('*')
          .order('starts_at', { ascending: true }),
        client
          .from('event_rsvps')
          .select('*')
          .order('created_at', { ascending: false }),
      ])

      if (eventsError || eventRsvpsError) {
        console.error(eventsError || eventRsvpsError)
        setEvents([])
        setEventRsvps([])
        setError(
          'Candidaturas e membros carregados. Eventos ainda precisam do schema atualizado.',
        )
        return
      }

      setEvents(eventsData || [])
      setEventRsvps(eventRsvpsData || [])

      const [
        { data: feedPostsData, error: feedPostsError },
        { data: feedCommentsData, error: feedCommentsError },
        { data: chatMessagesData, error: chatMessagesError },
      ] = await Promise.all([
        client
          .from('feed_posts')
          .select(
            `
              *,
              members:member_id (
                full_name,
                member_number,
                role,
                car_model,
                member_photo_url
              )
            `,
          )
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('feed_comments')
          .select(
            `
              *,
              members:member_id (
                full_name,
                member_number,
                role
              ),
              feed_posts:post_id (
                body
              )
            `,
          )
          .order('created_at', { ascending: false })
          .limit(100),
        client
          .from('chat_messages')
          .select(
            `
              *,
              members:member_id (
                full_name,
                member_number,
                role
              )
            `,
          )
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (feedPostsError || feedCommentsError || chatMessagesError) {
        console.error(feedPostsError || feedCommentsError || chatMessagesError)
        setFeedPosts([])
        setFeedComments([])
        setChatMessages([])
        setError(
          'Candidaturas, membros e eventos carregados. Moderação ainda precisa do schema atualizado.',
        )
        return
      }

      setFeedPosts(feedPostsData || [])
      setFeedComments(feedCommentsData || [])
      setChatMessages(chatMessagesData || [])

      if (managerRoles.includes(role)) {
        const { data: auditData, error: auditError } = await client
          .from('admin_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80)

        if (auditError) {
          console.error(auditError)
          setAuditLogs([])
          setError(
            'Dados carregados. Auditoria ainda precisa do schema atualizado.',
          )
          return
        }

        setAuditLogs(auditData || [])
      } else {
        setAuditLogs([])
      }
    } catch (loadError) {
      console.error(loadError)
      setError(
        loadError?.message ||
          'Erro ao carregar dados admin. Rode o schema atualizado no Supabase.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function restoreSession() {
      try {
        const client = getSupabase()
        const { data, error: sessionError } = await client.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (!isMounted) return

        setSession(data.session || null)

        if (data.session) {
          await loadData()
        }
      } catch (sessionError) {
        console.error(sessionError)

        if (isMounted) {
          setError(
            sessionError?.message ||
              'Nao foi possivel restaurar a sessao admin.',
          )
        }
      } finally {
        if (isMounted) {
          setCheckingSession(false)
        }
      }
    }

    void restoreSession()

    return () => {
      isMounted = false
    }
  }, [loadData])

  useEffect(() => {
    if (!isUnlocked || !canReviewApplications) {
      return undefined
    }

    const client = getSupabase()
    const channel = client
      .channel('admin-application-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'applications',
        },
        (payload) => {
          const newApplication = payload.new

          setApplications((current) => {
            if (current.some((item) => item.id === newApplication.id)) {
              return current
            }

            return [newApplication, ...current]
          })

          notifyNewApplication(newApplication)
        },
      )
      .subscribe((status) => {
        setRealtimeStatus(status === 'SUBSCRIBED' ? 'connected' : 'connecting')
      })

    return () => {
      client.removeChannel(channel)
    }
  }, [canReviewApplications, isUnlocked, notifyNewApplication])

  function handleCredentialChange(event) {
    const { name, value } = event.target

    setCredentials((current) => ({
      ...current,
      [name]: value,
    }))

    if (error) {
      setError('')
    }
  }

  async function loginAdmin(event) {
    event.preventDefault()

    const email = credentials.email.trim()

    if (!email || !credentials.password) {
      setError('Informe email e senha admin.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const client = getSupabase()
      const { data, error: loginError } = await client.auth.signInWithPassword({
        email,
        password: credentials.password,
      })

      if (loginError) {
        throw loginError
      }

      setSession(data.session || null)
      setCredentials({ email: '', password: '' })
      await loadData()
    } catch (loginError) {
      console.error(loginError)
      setError('Nao foi possivel entrar. Confira email, senha e admin_users.')
    } finally {
      setLoading(false)
    }
  }

  async function logoutAdmin() {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const client = getSupabase()
      const { error: logoutError } = await client.auth.signOut()

      if (logoutError) {
        throw logoutError
      }

      setSession(null)
      setApplications([])
      setMembers([])
      setEvents([])
      setEventRsvps([])
      setFeedPosts([])
      setFeedComments([])
      setChatMessages([])
      setAuditLogs([])
      setAdminRole('')
      setApplicationAlert(null)
      setRealtimeStatus('idle')
    } catch (logoutError) {
      console.error(logoutError)
      setError('Nao foi possivel sair da sessao admin.')
    } finally {
      setLoading(false)
    }
  }

  async function requestAdminNotifications() {
    if (!isAdminPushSupported()) {
      setNotificationPermission('unsupported')
      setError('Este navegador nao suporta Web Push.')
      setSuccess('')
      return
    }

    if (!isAdminPushConfigured()) {
      setError(
        'Configure VITE_ADMIN_PUSH_VAPID_PUBLIC_KEY para ativar Web Push.',
      )
      setSuccess('')
      return
    }

    if (notificationPermission === 'denied') {
      setError(
        'As notificacoes estao bloqueadas no navegador. Libere nas configuracoes do site.',
      )
      setSuccess('')
      return
    }

    try {
      const { permission } = await enableAdminPushNotifications()

      setNotificationPermission(permission)

      if (permission === 'granted') {
        setSuccess('Web Push de candidaturas ativado neste navegador.')
        setError('')
      } else {
        setError('Web Push nao foi ativado neste navegador.')
        setSuccess('')
      }
    } catch (pushError) {
      console.error(pushError)
      setNotificationPermission(getAdminPushPermission())
      setError(pushError?.message || 'Nao foi possivel ativar Web Push.')
      setSuccess('')
    }
  }

  function handleEventFormChange(event) {
    const { name, value } = event.target

    setEventForm((current) => ({
      ...current,
      [name]: value,
    }))

    if (error) {
      setError('')
    }
  }

  async function createEvent(event) {
    event.preventDefault()

    if (!canManageEvents) {
      setError('Seu cargo nao permite criar eventos.')
      return
    }

    const title = eventForm.title.trim()

    if (!title) {
      setError('Informe o nome do evento.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const startsAt = eventForm.starts_at
        ? new Date(eventForm.starts_at).toISOString()
        : null
      const capacity = eventForm.capacity
        ? Number(eventForm.capacity)
        : null

      await adminActions.createCrewEvent({
        title,
        description: eventForm.description.trim() || null,
        location: eventForm.location.trim() || null,
        startsAt,
        status: eventForm.status,
        capacity,
      })

      setEventForm({
        title: '',
        description: '',
        location: '',
        starts_at: '',
        status: 'open',
        capacity: '',
      })
      setSuccess('Evento criado.')
      await loadData()
    } catch (eventError) {
      console.error(eventError)
      setError(eventError?.message || 'Nao foi possivel criar o evento.')
    } finally {
      setLoading(false)
    }
  }

  async function updateEventStatus(event, status) {
    if (!canManageEvents) {
      setError('Seu cargo nao permite alterar eventos.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.updateCrewEventStatus(event.id, status)

      setSuccess('Status do evento atualizado.')
      await loadData()
    } catch (updateError) {
      console.error(updateError)
      setError('Nao foi possivel atualizar o evento.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteEvent(event) {
    if (!canManageEvents) {
      setError('Seu cargo nao permite apagar eventos.')
      return
    }

    const confirmed = window.confirm(`Deseja apagar o evento ${event.title}?`)

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.deleteCrewEvent(event.id)

      setSuccess('Evento apagado.')
      await loadData()
    } catch (deleteError) {
      console.error(deleteError)
      setError('Nao foi possivel apagar o evento.')
    } finally {
      setLoading(false)
    }
  }

  async function checkInMember(event, member, shouldThrow = false) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite fazer check-in.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.checkInEventMember(event.id, member.id)
      setSuccess(`Check-in confirmado para ${member.full_name}.`)
      await loadData()
    } catch (checkInError) {
      console.error(checkInError)
      setError(checkInError?.message || 'Nao foi possivel fazer check-in.')

      if (shouldThrow) {
        throw checkInError
      }
    } finally {
      setLoading(false)
    }
  }

  async function resetEventCheckIn(event, member) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite alterar check-in.')
      return
    }

    const confirmed = window.confirm(
      `Deseja desfazer o check-in de ${member.full_name}?`,
    )

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.resetEventCheckIn(event.id, member.id)

      setSuccess(`Check-in removido para ${member.full_name}.`)
      await loadData()
    } catch (updateError) {
      console.error(updateError)
      setError('Nao foi possivel desfazer o check-in.')
    } finally {
      setLoading(false)
    }
  }

  function exportEventAttendance(event, participants) {
    const csv = buildEventAttendanceCsv(event, participants)
    const fileName = `nofvce-${createSafeSlug(event.title)}-presenca.csv`

    downloadTextFile(fileName, csv)
  }

  async function approveApplication(application) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite revisar candidaturas.')
      return
    }

    if (!application.identity_rule_confirmed) {
      setError('A candidatura precisa confirmar a regra da carteirinha.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.approveApplication(application.id)
      setSuccess('Candidatura aprovada e membro criado.')
      await loadData()
    } catch (approveError) {
      console.error(approveError)
      setError(approveError?.message || 'Erro ao aprovar candidatura.')
    } finally {
      setLoading(false)
    }
  }

  async function rejectApplication(application) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite revisar candidaturas.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.rejectApplication(application.id)
      setSuccess('Candidatura rejeitada.')
      await loadData()
    } catch (rejectError) {
      console.error(rejectError)
      setError(rejectError?.message || 'Erro ao rejeitar candidatura.')
    } finally {
      setLoading(false)
    }
  }

  async function updateMemberRole(member, role) {
    if (!canManageMembers) {
      setError('Seu cargo nao permite mudar cargo de membro.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.updateMemberRole(member.id, role)
      setSuccess('Cargo atualizado.')
      await loadData()
    } catch (updateError) {
      console.error(updateError)
      setError(updateError?.message || 'Erro ao atualizar cargo.')
    } finally {
      setLoading(false)
    }
  }

  async function updateMemberStatus(member, status) {
    if (!canManageMembers) {
      setError('Seu cargo nao permite mudar status de membro.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.updateMemberStatus(member.id, status)
      setSuccess('Status atualizado.')
      await loadData()
    } catch (updateError) {
      console.error(updateError)
      setError(updateError?.message || 'Erro ao atualizar status.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteApplication(application) {
    if (!canManageMembers) {
      setError('Seu cargo nao permite apagar candidaturas.')
      return
    }

    const confirmed = window.confirm(
      `Deseja apagar a candidatura de ${application.full_name}?`,
    )

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.deleteApplication(application.id)
      setSuccess('Candidatura apagada com sucesso.')
      await loadData()
    } catch (applicationDeleteError) {
      console.error(applicationDeleteError)
      setError(
        applicationDeleteError?.message || 'Erro ao apagar candidatura.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function deleteMember(member) {
    if (!canManageMembers) {
      setError('Seu cargo nao permite apagar membros.')
      return
    }

    const confirmed = window.confirm(
      `Deseja apagar o membro ${member.full_name}?`,
    )

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const deletedLinkedApplication = await adminActions.deleteMember(member.id)

      setSuccess(
        deletedLinkedApplication
          ? 'Membro e candidatura vinculada apagados com sucesso.'
          : 'Membro apagado com sucesso.',
      )
      await loadData()
    } catch (memberDeleteError) {
      console.error(memberDeleteError)
      setError(memberDeleteError?.message || 'Erro ao apagar membro.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteFeedPost(post) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite moderar o feed.')
      return
    }

    const confirmed = window.confirm('Deseja apagar este post do feed?')

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.deleteFeedPost(post.id)

      setSuccess('Post apagado do feed.')
      await loadData()
    } catch (deleteError) {
      console.error(deleteError)
      setError('Nao foi possivel apagar o post.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteFeedComment(comment) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite moderar comentarios.')
      return
    }

    const confirmed = window.confirm('Deseja apagar este comentario?')

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.deleteFeedComment(comment.id)

      setSuccess('Comentario apagado.')
      await loadData()
    } catch (deleteError) {
      console.error(deleteError)
      setError('Nao foi possivel apagar o comentario.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteChatMessage(message) {
    if (!canReviewApplications) {
      setError('Seu cargo nao permite moderar o chat.')
      return
    }

    const confirmed = window.confirm('Deseja apagar esta mensagem do chat?')

    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await adminActions.deleteChatMessage(message.id)

      setSuccess('Mensagem apagada do chat.')
      await loadData()
    } catch (deleteError) {
      console.error(deleteError)
      setError('Nao foi possivel apagar a mensagem.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-black text-white">
        <Background />

        <section className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-[10px] uppercase tracking-[0.45em] text-white/30">
            NoFvce Admin
          </p>

          <h1 className="mt-4 text-5xl font-black uppercase leading-none">
            Checking
          </h1>

          <p className="mt-5 text-sm leading-6 text-white/45">
            Restaurando sessao administrativa.
          </p>
        </section>
      </main>
    )
  }

  if (!isUnlocked) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-black text-white">
        <Background />

        <section className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-[10px] uppercase tracking-[0.45em] text-white/30">
            NoFvce Admin
          </p>

          <h1 className="mt-4 text-5xl font-black uppercase leading-none">
            Restricted
          </h1>

          <p className="mt-5 text-sm leading-6 text-white/45">
            Entre com o usuario criado no Supabase Auth e liberado em
            public.admin_users.
          </p>

          <form
            onSubmit={loginAdmin}
            className="mt-8 space-y-4 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl"
          >
            <input
              name="email"
              type="email"
              value={credentials.email}
              onChange={handleCredentialChange}
              placeholder="Email admin"
              autoComplete="email"
              className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
            />

            <input
              name="password"
              type="password"
              value={credentials.password}
              onChange={handleCredentialChange}
              placeholder="Senha admin"
              autoComplete="current-password"
              className="w-full rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
            />

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
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <Background />

      <header className="relative z-20 flex w-full items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
        <a
          href="/"
          className="text-[10px] font-bold uppercase tracking-[0.45em] text-white/35 transition hover:text-white"
        >
          NOFVCE
        </a>

        <div className="flex items-center gap-4">
          <span className="hidden text-[10px] uppercase tracking-[0.25em] text-white/25 sm:inline">
            {session?.user?.email || 'Admin'} / {adminRole || 'sem cargo'}
          </span>

          {canReviewApplications && (
            <button
              type="button"
              onClick={requestAdminNotifications}
              className="text-[10px] uppercase tracking-[0.35em] text-white/35 transition hover:text-white disabled:opacity-40"
              disabled={notificationPermission === 'unsupported'}
            >
              {getNotificationButtonLabel(notificationPermission)}
            </button>
          )}

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="text-[10px] uppercase tracking-[0.35em] text-white/35 transition hover:text-white disabled:opacity-40"
          >
            {loading ? 'Syncing' : 'Sync'}
          </button>

          <button
            type="button"
            onClick={logoutAdmin}
            disabled={loading}
            className="text-[10px] uppercase tracking-[0.35em] text-white/35 transition hover:text-white disabled:opacity-40"
          >
            Sair
          </button>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        <p className="text-[10px] uppercase tracking-[0.45em] text-white/30">
          Admin Panel
        </p>

        <h1 className="mt-4 text-5xl font-black uppercase leading-none">
          Applications
        </h1>

        {canReviewApplications && (
          <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-white/25">
            Realtime {realtimeStatus === 'connected' ? 'online' : 'em espera'}{' '}
            / push {notificationPermission === 'granted' ? 'ativo' : 'off'}
          </p>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <StatCard
            label="Pendentes"
            value={pending}
            active={
              activeAdminSection === 'applications' &&
              applicationStatusFilter === 'pending'
            }
            onClick={() => {
              setActiveAdminSection('applications')
              setApplicationStatusFilter('pending')
            }}
          />
          <StatCard
            label="Aprovadas"
            value={approved}
            active={
              activeAdminSection === 'applications' &&
              applicationStatusFilter === 'approved'
            }
            onClick={() => {
              setActiveAdminSection('applications')
              setApplicationStatusFilter('approved')
            }}
          />
          <StatCard
            label="Rejeitadas"
            value={rejected}
            active={
              activeAdminSection === 'applications' &&
              applicationStatusFilter === 'rejected'
            }
            onClick={() => {
              setActiveAdminSection('applications')
              setApplicationStatusFilter('rejected')
            }}
          />
          <StatCard
            label="Membros"
            value={members.length}
            active={activeAdminSection === 'members'}
            onClick={() => setActiveAdminSection('members')}
          />
        </div>

        {applicationAlert && (
          <div className="mt-6 rounded-[1.5rem] border border-sky-400/20 bg-sky-400/10 px-5 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-sky-200">
                  Nova candidatura
                </p>

                <p className="mt-2 text-sm text-sky-50/70">
                  {applicationAlert.fullName} - {applicationAlert.carModel}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveAdminSection('applications')
                    setApplicationStatusFilter('pending')
                    setApplicationAlert(null)
                  }}
                  className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white/60 transition hover:border-white/20 hover:text-white"
                >
                  Ver
                </button>

                <button
                  type="button"
                  onClick={() => setApplicationAlert(null)}
                  className="rounded-full border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white/35 transition hover:border-white/20 hover:text-white"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="mt-6 rounded-[1.5rem] border border-emerald-500/20 bg-emerald-500/10 px-5 py-5 text-sm text-emerald-300">
            {success}
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-[1.5rem] border border-red-500/20 bg-red-500/10 px-5 py-5 text-sm text-red-300">
            {error}
          </div>
        )}

        <AdminSectionNav
          active={activeAdminSection}
          canViewAudit={canViewAuditLogs}
          counts={{
            applications: pending,
            members: members.length,
            events: events.length,
            moderation: moderationCount,
            audit: auditLogs.length,
          }}
          onChange={setActiveAdminSection}
        />

        {activeAdminSection === 'events' && (
          <>
            <h2 className="mt-10 text-2xl font-black uppercase">Eventos</h2>

            {canManageEvents && (
              <form
                onSubmit={createEvent}
                className="mt-6 grid gap-4 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl md:grid-cols-2"
              >
                <input
                  name="title"
                  value={eventForm.title}
                  onChange={handleEventFormChange}
                  placeholder="Nome do evento"
                  className="rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
                />

                <input
                  name="location"
                  value={eventForm.location}
                  onChange={handleEventFormChange}
                  placeholder="Local"
                  className="rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
                />

                <input
                  name="starts_at"
                  type="datetime-local"
                  value={eventForm.starts_at}
                  onChange={handleEventFormChange}
                  className="rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none"
                />

                <div className="grid grid-cols-2 gap-4">
                  <select
                    name="status"
                    value={eventForm.status}
                    onChange={handleEventFormChange}
                    className="rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none"
                  >
                    {eventStatuses.map((status) => (
                      <option key={status} value={status}>
                        {getEventStatusLabel(status)}
                      </option>
                    ))}
                  </select>

                  <input
                    name="capacity"
                    type="number"
                    min="1"
                    value={eventForm.capacity}
                    onChange={handleEventFormChange}
                    placeholder="Vagas"
                    className="rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25"
                  />
                </div>

                <textarea
                  name="description"
                  value={eventForm.description}
                  onChange={handleEventFormChange}
                  placeholder="Descricao"
                  rows="4"
                  className="resize-none rounded-2xl border border-white/5 bg-black/70 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25 md:col-span-2"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-full border border-white/10 bg-white/10 px-5 py-4 text-[10px] font-black uppercase tracking-[0.28em] text-white/45 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-30 md:col-span-2"
                >
                  Criar evento
                </button>
              </form>
            )}

            <EventCheckInScanner
              events={events}
              eventRsvps={eventRsvps}
              members={members}
              disabled={loading}
              canScan={canReviewApplications}
              onCheckIn={(event, member) => checkInMember(event, member, true)}
            />

            <div className="mt-6 grid gap-5 md:grid-cols-2">
          {events.length === 0 && !loading && (
            <div className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-6 text-sm text-white/40">
              Nenhum evento criado.
            </div>
          )}

          {events.map((crewEvent) => {
            const participants = eventRsvps
              .filter(
                (rsvp) =>
                  rsvp.event_id === crewEvent.id && rsvp.status === 'going',
              )
              .map((rsvp) => ({
                ...rsvp,
                member: members.find((member) => member.id === rsvp.member_id),
              }))
              .filter((rsvp) => rsvp.member)
            const checkedIn = participants.filter(
              (rsvp) => rsvp.checked_in_at,
            ).length
            const pendingCheckIn = Math.max(participants.length - checkedIn, 0)

            return (
              <article
                key={crewEvent.id}
                className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-white/25">
                      {formatAdminEventDate(crewEvent.starts_at)}
                    </p>

                    <h3 className="mt-2 text-2xl font-black uppercase">
                      {crewEvent.title}
                    </h3>
                  </div>

                  <StatusBadge status={getEventStatusLabel(crewEvent.status)} />
                </div>

                <p className="mt-3 text-xs uppercase tracking-[0.25em] text-white/30">
                  {crewEvent.location || 'Local secreto'}
                </p>

                <p className="mt-4 text-sm leading-6 text-white/50">
                  {crewEvent.description || '-'}
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-4">
                  <InfoBlock label="RSVP" value={participants.length} />
                  <InfoBlock label="Check-in" value={checkedIn} />
                  <InfoBlock label="Pendentes" value={pendingCheckIn} />
                  <InfoBlock
                    label="Vagas"
                    value={crewEvent.capacity || 'Livre'}
                  />
                </div>

                <div className="mt-5 space-y-3">
                  {participants.length === 0 && (
                    <p className="text-sm text-white/35">
                      Nenhum membro confirmou presenca.
                    </p>
                  )}

                  {participants.map((rsvp) => (
                    <div
                      key={`${rsvp.event_id}-${rsvp.member_id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/40 p-4"
                    >
                      <div>
                        <p className="text-sm font-black uppercase text-white">
                          {rsvp.member.full_name}
                        </p>

                        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/30">
                          {rsvp.member.member_number || 'NOFVCE'}
                        </p>

                        <p className="mt-2 text-xs leading-5 text-white/35">
                          {rsvp.member.car_model || 'Carro nao informado'}
                          {rsvp.checked_in_at
                            ? ` / Check-in ${formatAdminEventDate(
                                rsvp.checked_in_at,
                              )}`
                            : ' / Check-in pendente'}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => checkInMember(crewEvent, rsvp.member)}
                          disabled={loading || Boolean(rsvp.checked_in_at)}
                          className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {rsvp.checked_in_at ? 'Check-in ok' : 'Check-in'}
                        </button>

                        {rsvp.checked_in_at && (
                          <button
                            type="button"
                            onClick={() =>
                              resetEventCheckIn(crewEvent, rsvp.member)
                            }
                            disabled={loading}
                            className="rounded-full border border-white/10 bg-black/40 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/35 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            Desfazer
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => exportEventAttendance(crewEvent, participants)}
                    disabled={loading}
                    className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white/45 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Exportar CSV
                  </button>

                  {canManageEvents && (
                    <select
                      value={crewEvent.status}
                      onChange={(event) =>
                        updateEventStatus(crewEvent, event.target.value)
                      }
                      disabled={loading}
                      className="rounded-full border border-white/10 bg-black/40 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/45 outline-none disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {eventStatuses.map((status) => (
                        <option key={status} value={status}>
                          {getEventStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  )}

                  {canManageEvents && (
                    <button
                      type="button"
                      onClick={() => deleteEvent(crewEvent)}
                      disabled={loading}
                      className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Apagar evento
                    </button>
                  )}
                </div>
              </article>
            )
          })}
            </div>
          </>
        )}

        {activeAdminSection === 'moderation' && (
          <ModerationPanel
            chatMessages={chatMessages}
            feedComments={feedComments}
            feedPosts={feedPosts}
            loading={loading}
            onDeleteChatMessage={deleteChatMessage}
            onDeleteFeedComment={deleteFeedComment}
            onDeleteFeedPost={deleteFeedPost}
          />
        )}

        {activeAdminSection === 'audit' && canViewAuditLogs && (
          <AuditPanel auditLogs={auditLogs} loading={loading} />
        )}

        {activeAdminSection === 'applications' && (
          <>
            <h2 className="mt-10 text-2xl font-black uppercase">
              Candidaturas
            </h2>

            <ApplicationStatusFilter
              active={applicationStatusFilter}
              counts={{
                all: applications.length,
                pending,
                approved,
                rejected,
              }}
              onChange={setApplicationStatusFilter}
            />

            <div className="mt-6 grid gap-5">
              {visibleApplications.length === 0 && !loading && (
                <div className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-6 text-sm text-white/40">
                  Nenhuma candidatura nessa lista.
                </div>
              )}

              {visibleApplications.map((item) => (
                <article
                  key={item.id}
                  className="grid gap-5 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl md:grid-cols-[220px_1fr]"
                >
                  <div className="overflow-hidden rounded-[1.5rem] border border-white/5 bg-black/60">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.car_model}
                        className="h-56 w-full object-cover md:h-full"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center text-xs uppercase tracking-[0.25em] text-white/25">
                        Sem foto
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.35em] text-white/25">
                          Candidate
                        </p>

                        <h2 className="mt-2 text-3xl font-black uppercase">
                          {item.full_name}
                        </h2>

                        <p className="mt-2 text-sm text-white/40">
                          {item.instagram} - {item.whatsapp}
                        </p>
                      </div>

                      <StatusBadge status={item.status} />
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                      <InfoBlock label="Carro" value={item.car_model} />
                      <InfoBlock label="Setup" value={item.car_setup || '-'} />
                      <InfoBlock
                        label="Regra da carteirinha"
                        value={
                          item.identity_rule_confirmed
                            ? 'Confirmada'
                            : 'Nao confirmada'
                        }
                      />
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/5 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-white/25">
                        Mensagem
                      </p>

                      <p className="mt-3 text-sm leading-6 text-white/50">
                        {item.message || '-'}
                      </p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      {item.image_url && (
                        <a
                          href={item.image_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-black/40 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/35 transition hover:bg-white/10 hover:text-white"
                        >
                          Ver foto
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => approveApplication(item)}
                        disabled={loading || item.status === 'approved'}
                        className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/50 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Aprovar
                      </button>

                      <button
                        type="button"
                        onClick={() => rejectApplication(item)}
                        disabled={
                          loading ||
                          item.status === 'rejected' ||
                          (!canManageMembers && item.status === 'approved')
                        }
                        className="rounded-full border border-white/10 bg-black/40 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-white/35 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Rejeitar
                      </button>

                      {canManageMembers && (
                        <button
                          type="button"
                          onClick={() => deleteApplication(item)}
                          disabled={loading}
                          className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          Apagar
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {activeAdminSection === 'members' && (
          <>
            <h2 className="mt-10 text-2xl font-black uppercase">Membros</h2>

            <div className="mt-6 overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-900/60 backdrop-blur-xl">
              {members.length === 0 && !loading && (
                <div className="p-6 text-sm text-white/40">
                  Nenhum membro encontrado.
                </div>
              )}

              {members.map((member) => {
                const isExpanded = expandedMemberId === member.id
                const whatsAppUrl = createWhatsAppUrl(member)

                return (
                  <article
                    key={member.id}
                    className="border-b border-white/5 p-4 last:border-b-0"
                  >
                    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-red-400">
                          {member.member_number || 'NOFVCE'}
                        </p>

                        <h3 className="mt-1 truncate text-lg font-black uppercase">
                          {member.full_name}
                        </h3>

                        <p className="mt-1 truncate text-sm text-white/35">
                          {member.car_model || '-'}
                        </p>
                      </div>

                      <div className="min-w-0 text-sm text-white/45">
                        <p className="truncate">{member.whatsapp || '-'}</p>
                        <p className="mt-1 truncate">
                          {member.instagram || '-'}
                        </p>
                      </div>

                      <div className="min-w-0 text-xs text-white/40">
                        <p className="uppercase tracking-[0.2em]">
                          {member.role || 'member'} / {member.status || '-'}
                        </p>
                        <p className="mt-1 truncate font-mono text-white/60">
                          {member.access_code || '-'}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {canManageMembers && (
                          <>
                            <select
                              value={member.role || 'member'}
                              onChange={(event) =>
                                updateMemberRole(member, event.target.value)
                              }
                              disabled={loading}
                              className="rounded-full border border-white/10 bg-black/40 px-3 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 outline-none disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              {adminRoles.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>

                            <select
                              value={member.status || 'active'}
                              onChange={(event) =>
                                updateMemberStatus(member, event.target.value)
                              }
                              disabled={loading}
                              className="rounded-full border border-white/10 bg-black/40 px-3 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 outline-none disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <option value="active">active</option>
                              <option value="inactive">inactive</option>
                            </select>
                          </>
                        )}

                        {whatsAppUrl && (
                          <a
                            href={whatsAppUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-500/20"
                          >
                            Codigo
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMemberId(isExpanded ? '' : member.id)
                          }
                          className="rounded-full border border-white/10 bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/50 transition hover:bg-white hover:text-black"
                        >
                          {isExpanded ? 'Ocultar' : 'Carteira'}
                        </button>

                        {canManageMembers && (
                          <button
                            type="button"
                            onClick={() => deleteMember(member)}
                            disabled={loading}
                            className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            Apagar
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 grid gap-4 rounded-[1.5rem] border border-white/5 bg-black/40 p-4 lg:grid-cols-[360px_1fr]">
                        <MemberCard member={member} />

                        <div className="grid gap-3 sm:grid-cols-2">
                          <InfoBlock
                            label="Cargo"
                            value={member.role || 'member'}
                          />
                          <InfoBlock
                            label="Codigo secreto"
                            value={member.access_code || '-'}
                          />
                          <InfoBlock
                            label="WhatsApp"
                            value={member.whatsapp || '-'}
                          />
                          <InfoBlock
                            label="Instagram"
                            value={member.instagram || '-'}
                          />
                          <InfoBlock
                            label="Status"
                            value={member.status || '-'}
                          />
                          <InfoBlock
                            label="Entrada"
                            value={
                              member.created_at
                                ? new Date(member.created_at).toLocaleDateString(
                                    'pt-BR',
                                  )
                                : '-'
                            }
                          />
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function StatCard({ active = false, label, value, onClick }) {
  const Element = onClick ? 'button' : 'div'

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-[2rem] border p-5 text-left backdrop-blur-xl transition ${
        active
          ? 'border-white/15 bg-white text-black'
          : 'border-white/5 bg-zinc-900/60 text-white hover:border-white/10'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <p
        className={`text-[10px] uppercase tracking-[0.35em] ${
          active ? 'text-black/45' : 'text-white/25'
        }`}
      >
        {label}
      </p>

      <h3 className="mt-3 text-4xl font-black">{value}</h3>
    </Element>
  )
}

function ApplicationStatusFilter({ active, counts, onChange }) {
  const filters = [
    {
      id: 'pending',
      label: 'Pendentes',
      count: counts.pending,
    },
    {
      id: 'approved',
      label: 'Aprovadas',
      count: counts.approved,
    },
    {
      id: 'rejected',
      label: 'Rejeitadas',
      count: counts.rejected,
    },
    {
      id: 'all',
      label: 'Todas',
      count: counts.all,
    },
  ]

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {filters.map((filter) => {
        const isActive = active === filter.id

        return (
          <button
            key={filter.id}
            type="button"
            onClick={() => onChange(filter.id)}
            className={`rounded-full border px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition ${
              isActive
                ? 'border-white bg-white text-black'
                : 'border-white/10 bg-black/30 text-white/35 hover:bg-white/10 hover:text-white'
            }`}
          >
            {filter.label} / {filter.count}
          </button>
        )
      })}
    </div>
  )
}

function AdminSectionNav({ active, canViewAudit = false, counts, onChange }) {
  const items = [
    {
      id: 'applications',
      label: 'Candidaturas',
      count: counts.applications,
    },
    {
      id: 'members',
      label: 'Membros',
      count: counts.members,
    },
    {
      id: 'events',
      label: 'Eventos',
      count: counts.events,
    },
    {
      id: 'moderation',
      label: 'Moderacao',
      count: counts.moderation,
    },
    ...(canViewAudit
      ? [
          {
            id: 'audit',
            label: 'Auditoria',
            count: counts.audit,
          },
        ]
      : []),
  ]

  return (
    <nav
      className={`mt-8 grid gap-2 rounded-[2rem] border border-white/5 bg-zinc-900/60 p-2 backdrop-blur-xl ${
        canViewAudit ? 'md:grid-cols-5' : 'md:grid-cols-4'
      }`}
    >
      {items.map((item) => {
        const isActive = active === item.id

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`flex items-center justify-between rounded-[1.5rem] px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.24em] transition ${
              isActive
                ? 'bg-white text-black'
                : 'bg-black/30 text-white/35 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
            <span
              className={`rounded-full px-2 py-1 text-[10px] ${
                isActive ? 'bg-black/10 text-black' : 'bg-white/10 text-white/45'
              }`}
            >
              {item.count}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function AuditPanel({ auditLogs, loading }) {
  return (
    <>
      <h2 className="mt-10 text-2xl font-black uppercase">Auditoria</h2>

      <div className="mt-6 overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-900/60 backdrop-blur-xl">
        {auditLogs.length === 0 && !loading && (
          <div className="p-6 text-sm text-white/40">
            Nenhum registro de auditoria encontrado.
          </div>
        )}

        {auditLogs.map((log) => (
          <article
            key={log.id}
            className="grid gap-4 border-b border-white/5 p-4 last:border-b-0 lg:grid-cols-[1fr_1fr_1.2fr] lg:items-start"
          >
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.25em] text-red-400">
                {formatAuditAction(log.action)}
              </p>

              <h3 className="mt-1 truncate text-sm font-black uppercase">
                {log.target_type || 'alvo'} / {log.target_id || '-'}
              </h3>
            </div>

            <div className="min-w-0 text-sm text-white/45">
              <p className="truncate">{log.admin_email || 'Admin'}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/30">
                {log.admin_role || '-'} / {formatAdminEventDate(log.created_at)}
              </p>
            </div>

            <pre className="max-h-32 overflow-auto rounded-2xl border border-white/5 bg-black/40 p-3 text-xs leading-5 text-white/40">
              {formatAuditMetadata(log.metadata)}
            </pre>
          </article>
        ))}
      </div>
    </>
  )
}

function ModerationPanel({
  chatMessages,
  feedComments,
  feedPosts,
  loading,
  onDeleteChatMessage,
  onDeleteFeedComment,
  onDeleteFeedPost,
}) {
  return (
    <>
      <h2 className="mt-10 text-2xl font-black uppercase">Moderação</h2>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <ModerationColumn
          emptyLabel="Nenhum post no feed."
          loading={loading}
          title="Feed Posts"
        >
          {feedPosts.map((post) => {
            const images = Array.isArray(post.image_urls)
              ? post.image_urls
              : []

            return (
              <article
                key={post.id}
                className="rounded-[1.5rem] border border-white/5 bg-black/35 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase text-white">
                      {post.members?.full_name || 'NoFvce'}
                    </p>

                    <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/30">
                      {post.members?.member_number || 'NOFVCE'} /{' '}
                      {formatAdminEventDate(post.created_at)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteFeedPost(post)}
                    disabled={loading}
                    className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-red-300 disabled:opacity-35"
                  >
                    Apagar
                  </button>
                </div>

                {post.body && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/55">
                    {post.body}
                  </p>
                )}

                {images.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {images.slice(0, 4).map((imageUrl) => (
                      <img
                        key={imageUrl}
                        src={imageUrl}
                        alt="Post"
                        className="aspect-square rounded-xl object-cover"
                      />
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </ModerationColumn>

        <ModerationColumn
          emptyLabel="Nenhum comentario no feed."
          loading={loading}
          title="Comentários"
        >
          {feedComments.map((comment) => (
            <article
              key={comment.id}
              className="rounded-[1.5rem] border border-white/5 bg-black/35 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase text-white">
                    {comment.members?.full_name || 'NoFvce'}
                  </p>

                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/30">
                    {comment.members?.member_number || 'NOFVCE'} /{' '}
                    {formatAdminEventDate(comment.created_at)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onDeleteFeedComment(comment)}
                  disabled={loading}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-red-300 disabled:opacity-35"
                >
                  Apagar
                </button>
              </div>

              <p className="mt-3 text-sm leading-6 text-white/55">
                {comment.body}
              </p>

              {comment.feed_posts?.body && (
                <p className="mt-3 rounded-2xl border border-white/5 bg-black/40 p-3 text-xs leading-5 text-white/30">
                  Post: {comment.feed_posts.body}
                </p>
              )}
            </article>
          ))}
        </ModerationColumn>

        <ModerationColumn
          emptyLabel="Nenhuma mensagem no chat."
          loading={loading}
          title="Chat"
        >
          {chatMessages.map((message) => (
            <article
              key={message.id}
              className="rounded-[1.5rem] border border-white/5 bg-black/35 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase text-white">
                    {message.members?.full_name || 'NoFvce'}
                  </p>

                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/30">
                    {message.members?.member_number || 'NOFVCE'} /{' '}
                    {formatAdminEventDate(message.created_at)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onDeleteChatMessage(message)}
                  disabled={loading}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-red-300 disabled:opacity-35"
                >
                  Apagar
                </button>
              </div>

              <p className="mt-3 text-sm leading-6 text-white/55">
                {message.body}
              </p>
            </article>
          ))}
        </ModerationColumn>
      </div>
    </>
  )
}

function ModerationColumn({ children, emptyLabel, loading, title }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children)

  return (
    <section className="rounded-[2rem] border border-white/5 bg-zinc-900/60 p-5 backdrop-blur-xl">
      <p className="text-[10px] uppercase tracking-[0.35em] text-white/25">
        {title}
      </p>

      <div className="mt-5 space-y-3">
        {!hasItems && !loading && (
          <p className="text-sm text-white/35">{emptyLabel}</p>
        )}

        {children}
      </div>
    </section>
  )
}

function InfoBlock({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/40 p-4">
      <p className="text-[10px] uppercase tracking-[0.3em] text-white/25">
        {label}
      </p>

      <p className="mt-2 text-sm text-white/55">{value}</p>
    </div>
  )
}

function StatusBadge({ status }) {
  const normalizedStatus = status || 'pending'

  const label =
    {
      pending: 'Pendente',
      approved: 'Aprovado',
      rejected: 'Rejeitado',
    }[normalizedStatus] || normalizedStatus

  return (
    <span className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-white/40">
      {label}
    </span>
  )
}

function getEventStatusLabel(status) {
  return (
    {
      draft: 'Rascunho',
      open: 'Aberto',
      closed: 'Fechado',
      completed: 'Finalizado',
      cancelled: 'Cancelado',
    }[status] || status
  )
}

function buildEventAttendanceCsv(event, participants) {
  const rows = [
    [
      'Evento',
      'Data do evento',
      'Nome',
      'Numero',
      'Cargo',
      'Carro',
      'WhatsApp',
      'Instagram',
      'RSVP',
      'Check-in',
      'Data do RSVP',
    ],
    ...participants.map((rsvp) => [
      event.title || '',
      formatAdminEventDate(event.starts_at),
      rsvp.member.full_name || '',
      rsvp.member.member_number || '',
      rsvp.member.role || '',
      rsvp.member.car_model || '',
      rsvp.member.whatsapp || '',
      rsvp.member.instagram || '',
      rsvp.status || '',
      rsvp.checked_in_at ? formatAdminEventDate(rsvp.checked_in_at) : '',
      formatAdminEventDate(rsvp.created_at),
    ]),
  ]

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\n')
}

function escapeCsvValue(value) {
  const normalizedValue = String(value ?? '')

  return `"${normalizedValue.replace(/"/g, '""')}"`
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function createSafeSlug(value) {
  const slug = String(value || 'evento')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'evento'
}

function formatAuditAction(action) {
  return String(action || 'acao').replace(/_/g, ' ')
}

function formatAuditMetadata(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return '{}'
  }

  return JSON.stringify(metadata, null, 2)
}

function formatAdminEventDate(value) {
  if (!value) return 'Data em breve'

  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getNotificationButtonLabel(permission) {
  const labels = {
    granted: 'Push on',
    denied: 'Push off',
    default: 'Push',
    unsupported: 'Sem push',
  }

  return labels[permission] || 'Push'
}

export default Admin
