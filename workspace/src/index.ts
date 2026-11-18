import { Hono } from 'hono'
import {
  setCookie,
  getCookie,
  deleteCookie
} from 'hono/cookie'

type Bindings = {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_CALLBACK_URL: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }

    return entities[char]
  })
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.html(`
    <h1>Workspace</h1>
    <a href="/auth/github">Login com GitHub</a>
  `)
})

app.get('/auth/github', (c) => {
  const state = crypto.randomUUID()

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: 600
  })

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: c.env.GITHUB_CALLBACK_URL,
    scope: 'read:user',
    state
  })

  const authUrl =
    `https://github.com/login/oauth/authorize?${params}`

  return c.redirect(authUrl)
})

app.get('/auth/github/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const savedState = getCookie(c, 'oauth_state')


  if (error) {
    return c.text(`Erro de autenticação: ${error}`, 400)
  }

  if (!code) {
    return c.text('Código de autorização ausente', 400)
  }

  if (!state || !savedState || state !== savedState) {
    return c.text('Estado de autenticação inválido', 400)
  }

  deleteCookie(c, 'oauth_state', {
    path: '/',
  })

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: c.env.GITHUB_CALLBACK_URL,
    }),
  })

  const tokenData = await tokenResponse.json() as {
    access_token?: string
    token_type?: string
    scope?: string
    error?: string
    error_description?: string
  }

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error('Erro ao obter token de acesso:', tokenData.error, tokenResponse.status, tokenData.error_description)
    return c.text(`Erro ao obter token de acesso: ${tokenData.error_description || 'Desconhecido'}`, 400)
  }

    const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Workspace'
    },
  })

  if (!userResponse.ok) {
    return c.text(
      'Erro ao consultar o usuário do GitHub.',
      502
    )
  }

  const user = await userResponse.json() as {
    id: number
    name: string | null
    login: string
    avatar_url: string
    html_url: string
  }

  console.log('Usuário autenticado:', user)

  const name = escapeHtml(user.name || user.login)
  const login = escapeHtml(user.login)
  const avatar = new URL(user.avatar_url)
  const avatarUrl =
    avatar.protocol === 'https:'
      ? escapeHtml(avatar.href)
      : ''

  c.header('Cache-Control', 'no-store')

  return c.html(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <title>Workspace</title>
      </head>
      <body>
        <main>
          <h1>Bem-vindo ao Workspace!</h1>

          ${avatarUrl
            ? `<img
                src="${avatarUrl}"
                alt="Foto de perfil"
                width="100"
              />`
            : ''}

          <h2>${name}</h2>
          <p>Usuário: @${login}</p>
          <p>Autenticação realizada com sucesso!</p>

          <a href="/">Voltar ao início</a>
        </main>
      </body>
    </html>
  `)

})
export default app
