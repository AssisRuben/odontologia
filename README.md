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
