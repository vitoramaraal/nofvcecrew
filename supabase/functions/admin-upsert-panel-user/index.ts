import {
  createClient,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2'

type AdminRole = 'founder' | 'admin' | 'moderator'

type RequestBody = {
  email?: string
  password?: string
  role?: AdminRole
}

type AuthUser = {
  id: string
  email?: string
}

type AdminRecord = {
  email: string | null
  id: string
  role: AdminRole
}

type ServiceClient = SupabaseClient<any, 'public', 'public', any, any>

const allowedRoles = ['founder', 'admin', 'moderator'] as const
const managerRoles = ['founder', 'admin']
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseSecretKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || readSupabaseSecretKey()

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (!supabaseUrl || !supabaseSecretKey) {
    return json({ error: 'Missing Supabase service configuration' }, 500)
  }

  const authorization = request.headers.get('Authorization') || ''
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim()

  if (!jwt) {
    return json({ error: 'Missing admin session' }, 401)
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
    },
  })
  const { data: callerData, error: callerError } =
    await supabase.auth.getUser(jwt)

  if (callerError || !callerData.user) {
    console.error(callerError)
    return json({ error: 'Invalid admin session' }, 401)
  }

  const caller = callerData.user
  const callerAdmin = await getAdminRecord(supabase, caller.id)

  if (!callerAdmin || !isManagerRole(callerAdmin.role)) {
    return json({ error: 'Founder or admin access required' }, 403)
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody
  const email = normalizeEmail(body.email || '')
  const password = body.password || ''
  const role = normalizeRole(body.role || 'moderator')

  if (!email || !isValidEmail(email)) {
    return json({ error: 'Invalid email' }, 400)
  }

  if (!role) {
    return json({ error: 'Invalid role' }, 400)
  }

  if (role === 'founder' && callerAdmin.role !== 'founder') {
    return json({ error: 'Only founders can create founder users' }, 403)
  }

  if (password.length < 8) {
    return json({ error: 'Password must have at least 8 characters' }, 400)
  }

  let authUser: AuthUser | null = await findUserByEmail(supabase, email)
  let createdAuthUser = false
  let existingAdmin: AdminRecord | null = null

  if (authUser) {
    existingAdmin = await getAdminRecord(supabase, authUser.id)

    if (existingAdmin?.role === 'founder' && callerAdmin.role !== 'founder') {
      return json({ error: 'Only founders can change founder users' }, 403)
    }
  }

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: {
        nofvce_admin_role: role,
      },
    })

    if (error || !data.user) {
      console.error(error)
      return json({ error: 'Could not create auth user' }, 500)
    }

    authUser = data.user
    createdAuthUser = true
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
      password,
      user_metadata: {
        nofvce_admin_role: role,
      },
    })

    if (error) {
      console.error(error)
      return json({ error: 'Could not update auth user' }, 500)
    }
  }

  const { error: upsertError } = await supabase
    .from('admin_users')
    .upsert(
      {
        email,
        id: authUser.id,
        role,
      },
      {
        onConflict: 'id',
      },
    )

  if (upsertError) {
    console.error(upsertError)
    return json({ error: 'Could not save admin access' }, 500)
  }

  const { error: auditError } = await supabase
    .from('admin_audit_logs')
    .insert({
      action: 'upsert_admin_user',
      admin_email: caller.email || callerAdmin.email || null,
      admin_role: callerAdmin.role,
      admin_user_id: caller.id,
      metadata: {
        created_auth_user: createdAuthUser,
        email,
        previous_role: existingAdmin?.role || null,
        role,
      },
      target_id: authUser.id,
      target_type: 'admin_user',
    })

  if (auditError) {
    console.error(auditError)
  }

  return json({
    created_auth_user: createdAuthUser,
    email,
    id: authUser.id,
    role,
  })
})

async function getAdminRecord(
  supabase: ServiceClient,
  userId: string,
): Promise<AdminRecord | null> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw new Error('Could not load admin record')
  }

  return data as AdminRecord | null
}

async function findUserByEmail(
  supabase: ServiceClient,
  email: string,
): Promise<AuthUser | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    })

    if (error) {
      console.error(error)
      throw new Error('Could not search auth users')
    }

    const user = data.users.find(
      (candidate) => normalizeEmail(candidate.email || '') === email,
    )

    if (user) {
      return user
    }

    if (data.users.length < 1000) {
      return null
    }
  }

  return null
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeRole(value: string): AdminRole | '' {
  const role = value.trim().toLowerCase() as AdminRole

  return allowedRoles.includes(role) ? role : ''
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isManagerRole(role: string) {
  return managerRoles.includes(role)
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  })
}

function readSupabaseSecretKey() {
  const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS') || ''

  try {
    const parsedSecretKeys = JSON.parse(rawSecretKeys) as Record<string, string>

    return parsedSecretKeys.default || Object.values(parsedSecretKeys)[0] || ''
  } catch {
    return rawSecretKeys
  }
}
