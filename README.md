# Dental App

Sistema de gestão para clínica odontológica: agenda, pacientes (prontuário, odontograma, anamnese, orçamentos, documentos), financeiro, prótese, estoque e relatórios.

**Stack:** Next.js 16 · React 19 · Tailwind CSS v4 · Supabase (banco Postgres, login e armazenamento de arquivos)

---

## Como rodar o projeto do zero

Você vai precisar de:
- [Node.js](https://nodejs.org) 20 ou mais recente
- [Git](https://git-scm.com)
- Uma conta gratuita no [Supabase](https://supabase.com)

### 1. Baixar o código

```bash
git clone https://github.com/AssisRuben/odontologia.git
cd odontologia
npm install
```

### 2. Criar o banco no Supabase

1. Entre em [supabase.com/dashboard](https://supabase.com/dashboard) e clique em **New project**.
   Escolha um nome, defina uma senha para o banco (guarde-a) e a região **South America (São Paulo)**.
2. Espere o projeto terminar de ser criado (1–2 minutos).
3. No menu lateral, abra **SQL Editor** → **New query**.
4. Copie **todo** o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql), cole no editor e clique em **Run**.
   Deve aparecer *"Success. No rows returned"*. Isso cria todas as tabelas, permissões, o bucket de documentos e a regra que cria a clínica automaticamente no cadastro.
5. No menu lateral, abra **Authentication** → **Sign In / Providers** → **Email** e **desative "Confirm email"**.
   Assim a conta funciona logo após o cadastro, sem precisar confirmar por e-mail (recomendado em desenvolvimento).

### 3. Configurar as chaves

1. No Supabase, abra **Project Settings** → **API** (ou **API Keys**).
2. Na pasta do projeto, copie o arquivo `.env.example` com o nome `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
3. Preencha o `.env.local` com os valores do seu projeto:

   | Variável | Onde encontrar |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL (ex.: `https://abcdxyz.supabase.co`) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` / `public` |
   | `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` — **secreta**, usada só pelo script de dados de teste |

> ⚠️ O `.env.local` **nunca** vai para o GitHub (já está no `.gitignore`). Não cole essas chaves no código.

### 4. Rodar

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000), clique em **Criar conta** e cadastre-se com seu nome e o nome da clínica.
Pronto: você entra na agenda com uma clínica vazia.

### 5. (Opcional) Carregar dados de teste

Para preencher a clínica com pacientes, profissionais, agendamentos, pagamentos, despesas, próteses e estoque fictícios:

```bash
node --env-file=.env.local scripts/seed.mjs
```

Os dados vão para a primeira clínica do banco (a que foi criada no seu cadastro). Para escolher outra, defina `CLINIC_ID=<id da clínica>` no `.env.local`.
Pode rodar mais de uma vez sem duplicar nada.

---

## WhatsApp automático

O sistema pode enviar sozinho, pelo WhatsApp da clínica: lembrete e confirmação de consulta, aviso de pós-consulta e recall (paciente que passou 6 meses sem voltar). As respostas dos pacientes ("1 = confirmo") atualizam a agenda.

Para isso o app conversa com a **Evolution API**, um serviço que mantém o WhatsApp da clínica conectado (como o "WhatsApp Web"). Você precisa dele rodando em algum lugar: no seu computador (para testar) ou num servidor (produção).

### 1. Preparar o banco

1. No Supabase, abra **Database** → **Extensions** e ative **pg_cron** e **pg_net**.
2. Se o seu banco é antigo, aplique antes [`supabase/2026-11-02-isolamento-por-clinica.sql`](supabase/2026-11-02-isolamento-por-clinica.sql) e depois [`supabase/2026-11-02-whatsapp-automatico.sql`](supabase/2026-11-02-whatsapp-automatico.sql) (SQL Editor → cole o arquivo → **Run**). Pode rodar de novo sem problema.
3. Bancos novos criados com `supabase/schema.sql` já têm as tabelas, mas o `schema.sql` **não** ativa pg_cron e pg_net: faça o passo 1 de qualquer forma.

### 2. Variáveis de ambiente

Acrescente no `.env.local` (veja o `.env.example`):

| Variável | O que é |
|---|---|
| `EVOLUTION_API_URL` | endereço da Evolution API (local: `http://localhost:8080`) |
| `EVOLUTION_API_KEY` | chave de administrador da Evolution API (a mesma `AUTHENTICATION_API_KEY` do `.env.evolution`) |
| `CRON_SECRET` | senha que o agendador do banco usa para chamar `/api/cron/messages` |
| `EVOLUTION_WEBHOOK_TOKEN` | senha que a Evolution API usa ao avisar o app de respostas e desconexões |
| `APP_URL` | endereço do app que a Evolution API consegue acessar (veja abaixo) |

Para gerar uma senha aleatória (use uma diferente para cada segredo):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Evolution API no seu computador (teste)

Precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto (no Windows também).

```bash
cp .env.evolution.example .env.evolution
# edite .env.evolution: defina AUTHENTICATION_API_KEY e a senha do Postgres
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
```

No `.env.local`: `EVOLUTION_API_URL=http://localhost:8080`, `EVOLUTION_API_KEY` igual à `AUTHENTICATION_API_KEY`, e
`APP_URL=http://host.docker.internal:3000`. Como a Evolution roda dentro do Docker, ela chama o app por `host.docker.internal`; use a **porta que o `npm run dev` mostrar** (3000, ou 3001 se a 3000 estiver ocupada). Reinicie o `npm run dev` depois de mudar o `.env.local`.

No teste local o banco (Supabase na nuvem) não consegue chamar o seu computador, então o disparo a cada 5 minutos não acontece sozinho. Para testar, chame o endpoint à mão:

```bash
curl -X POST http://localhost:3000/api/cron/messages -H "Authorization: Bearer SEU_CRON_SECRET"
```

### 4. Produção

- **App:** na Vercel, cadastre as 5 variáveis acima (com `APP_URL` = endereço público do app, sem barra no final).
- **Evolution API:** num servidor (VPS) com Docker, usando o mesmo `docker-compose.evolution.yml`. Coloque `EVOLUTION_API_URL` apontando para ele, de preferência com HTTPS.
- **Agendador:** no fim de `supabase/2026-11-02-whatsapp-automatico.sql` há um bloco `cron.schedule` comentado. Descomente, troque `<APP_URL>` e `<CRON_SECRET>` e rode só esse bloco no SQL Editor. Ele faz o banco chamar `POST /api/cron/messages` **a cada 5 minutos**, e é essa chamada que envia as mensagens.

### 5. Conectar o WhatsApp da clínica

1. No app: **Configurações** → **Mensagens** → **Conectar WhatsApp**. Aparece um QR code.
2. No celular da clínica: WhatsApp → **Aparelhos conectados** → **Conectar aparelho** e escaneie o QR code.
3. Em **Mensagens** → **Automáticas**, ligue os tipos de mensagem que quiser.

### Cuidados

Esta integração usa a conexão **não oficial** do WhatsApp (Evolution/Baileys). Se o número enviar demais, ele **pode ser banido**. Por isso o app só envia entre 08:00 e 20:00, respeita um limite diário (padrão: 300 mensagens) e espaça os envios com intervalos aleatórios. O recall só vale para pacientes que completaram 6 meses nos últimos 30 dias. Prefira um número da clínica dedicado a isso.

---

## Trabalhando em equipe

- **Antes de começar a mexer:** `git pull`
- **Ao terminar algo:** `git add .` → `git commit -m "o que foi feito"` → `git push`
- Para mudanças grandes, crie uma branch (`git checkout -b nome-da-mudanca`) e abra um Pull Request no GitHub.
- **Mudou o banco?** (nova tabela, nova coluna) Crie um arquivo SQL novo em `supabase/` com a alteração (ex.: `supabase/2026-10-20-adiciona-coluna-x.sql`) e faça commit junto com o código, para que os outros possam aplicar no banco deles.

## Estrutura

```
src/
  app/(auth)/          login e cadastro
  app/(dashboard)/     telas do sistema (agenda, pacientes, financeiro, ...)
  components/          componentes por área (agenda, paciente, layout, ui)
  lib/supabase/        conexão com o Supabase (navegador e servidor)
  store/               estado global (clínica atual)
  types/               tipos das tabelas
  proxy.ts             redireciona para /login quem não está logado
supabase/schema.sql    estrutura completa do banco — use este para criar um banco novo
scripts/seed.mjs       dados de teste
```

Os arquivos `seed.sql` e `scripts/*.sql` são histórico do banco original e **não** são necessários num banco novo: tudo o que eles fazem já está em `supabase/schema.sql`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | roda em modo desenvolvimento (localhost:3000) |
| `npm run build` | gera a versão de produção |
| `npm run start` | roda a versão de produção |
| `npm run lint` | verifica o código |
| `npm test` | roda os testes automáticos |
