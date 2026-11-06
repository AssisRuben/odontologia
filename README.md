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

O sistema pode enviar sozinho, pelo WhatsApp da clínica, cinco mensagens automáticas: confirmação de consulta, lembrete de consulta, retorno (paciente que passou 6 meses sem voltar), aniversário e cobrança de pagamento em atraso. As respostas dos pacientes à confirmação ("1 = confirmo", "2 = desmarcar") atualizam a agenda.

Para isso o app conversa com a **Evolution API**, um serviço que mantém o WhatsApp da clínica conectado (como o "WhatsApp Web"). Você precisa dele rodando em algum lugar: no seu computador (para testar) ou num servidor (produção).

### 1. Preparar o banco

1. No Supabase, abra **Database** → **Extensions** e ative **pg_cron** e **pg_net**.
2. Se o seu banco é antigo, aplique antes [`supabase/2026-11-02-isolamento-por-clinica.sql`](supabase/2026-11-02-isolamento-por-clinica.sql) e depois [`supabase/2026-11-02-whatsapp-automatico.sql`](supabase/2026-11-02-whatsapp-automatico.sql) (SQL Editor → cole o arquivo → **Run**). Pode rodar de novo sem problema.
3. Bancos novos criados com `supabase/schema.sql` já têm as tabelas, mas o `schema.sql` **não** ativa pg_cron e pg_net: faça o passo 1 de qualquer forma.
4. Nas configurações da API do Supabase (**Project Settings** → **Data API**), deixe **Max rows** em 1000 ou mais: o envio automático lê o banco em páginas de 1000 linhas.

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
# (a senha também vai dentro de DATABASE_CONNECTION_URI; as duas precisam ser iguais)
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
```

No `.env.local`: `EVOLUTION_API_URL=http://localhost:8080`, `EVOLUTION_API_KEY` igual à `AUTHENTICATION_API_KEY`, e
`APP_URL=http://host.docker.internal:3000`. Como a Evolution roda dentro do Docker, ela chama o app por `host.docker.internal`; use a **porta que o `npm run dev` mostrar** (3000, ou 3001 se a 3000 estiver ocupada). Reinicie o `npm run dev` depois de mudar o `.env.local`.

No teste local o banco (Supabase na nuvem) não consegue chamar o seu computador, então o disparo a cada 5 minutos não acontece sozinho. Para testar, chame o endpoint à mão:

```bash
curl -X POST http://localhost:3000/api/cron/messages -H "Authorization: Bearer SEU_CRON_SECRET"
```

No PowerShell do Windows use `curl.exe` no lugar de `curl` (ou rode no Git Bash).

### 4. Produção

- **App:** na Vercel, cadastre as 5 variáveis acima (com `APP_URL` = endereço público do app, sem barra no final).
- **Evolution API:** num servidor (VPS) com Docker, usando o mesmo `docker-compose.evolution.yml`. Coloque `EVOLUTION_API_URL` apontando para ele, de preferência com HTTPS.
- **Agendador:** no fim de `supabase/2026-11-02-whatsapp-automatico.sql` há um bloco `cron.schedule` comentado. Descomente, troque `<APP_URL>` e `<CRON_SECRET>` e rode só esse bloco no SQL Editor. Ele faz o banco chamar `POST /api/cron/messages` **a cada 5 minutos**, e é essa chamada que envia as mensagens.

### 5. Conectar o WhatsApp da clínica

1. No app: **Configurações** → **Configurações de mensagens** → **Conectar WhatsApp**. Aparece um QR code.
2. No celular da clínica: WhatsApp → **Aparelhos conectados** → **Conectar aparelho** e escaneie o QR code.
3. Em **Mensagens** → **Automáticas**, ligue os tipos de mensagem que quiser.

### Cuidados

Esta integração usa a conexão **não oficial** do WhatsApp (Evolution/Baileys). Se o número enviar demais, ele **pode ser banido**. Por isso o app só envia entre 08:00 e 20:00, respeita um limite diário (padrão: 300 mensagens) e espaça os envios com intervalos aleatórios. O recall só vale para pacientes que completaram 6 meses nos últimos 30 dias. Prefira um número da clínica dedicado a isso.

Privacidade: o app só guarda mensagens recebidas de pacientes cadastrados (ou de quem recebeu uma confirmação nas últimas 48 horas). Conversas de outras pessoas com o número da clínica não vão para o banco.

---

## Cobrança integrada (Asaas)

O app pode gerar cobranças (Pix, boleto, cartão), enviar o link ao paciente pelo WhatsApp e dar baixa sozinho quando o pagamento cai. Quem processa o dinheiro é o **Asaas**: cada clínica usa a **sua própria conta** lá.

### O que o app faz

- **À vista:** um link em que o paciente escolhe Pix, boleto ou cartão.
- **Carnê:** boletos mensais, cada um com QR code Pix.
- **Cartão parcelado:** até 12x.
- **Registrar sem link:** para dinheiro, maquininha própria ou convênio.
- O link vai pelo WhatsApp da clínica; as notificações do próprio Asaas ficam desligadas. O status do pagamento atualiza automaticamente. Multa e juros padrão: 2% e 1% ao mês.

### 1. Conta e chave de API

- Teste: conta no sandbox, <https://sandbox.asaas.com>. Produção: <https://www.asaas.com>.
- A chave fica no painel do Asaas em **Integrações** → **Chaves de API**.
- No app: **Configurações** → **Pagamentos**, escolha **Teste (sandbox)** ou **Produção** e cole a chave. O app cadastra o webhook sozinho.

### 2. Banco

No SQL Editor do Supabase, aplique [`supabase/2026-11-04-cobranca-asaas.sql`](supabase/2026-11-04-cobranca-asaas.sql) (pode rodar de novo sem problema).

Conferência diária (garante que nenhum pagamento fique desatualizado): no fim desse arquivo há um bloco `cron.schedule('payments-reconcile', '0 9 * * *', …)` comentado. Descomente, troque `<APP_URL>` e `<CRON_SECRET>` e rode só esse bloco. Ele roda todo dia às 06:00 (Brasília). Para disparar à mão:

```bash
curl -X POST <APP_URL>/api/cron/payments -H "Authorization: Bearer <CRON_SECRET>"
```

Conferência rápida das cobranças em criação (quando o Asaas não responde na hora, a cobrança fica "sendo criada"): logo abaixo há um segundo bloco, `cron.schedule('payments-creating', '*/15 * * * *', …)`, que chama `<APP_URL>/api/cron/payments?scope=creating` **a cada 15 minutos** e só confere essas cobranças. Descomente, faça as mesmas trocas e rode só esse bloco. Sem ele, essas cobranças só se resolvem na conferência diária.

No PowerShell use `curl.exe` no lugar de `curl`.

### 3. Webhook e teste local

O Asaas avisa o app em `<ASAAS_WEBHOOK_BASE_URL ou APP_URL>/api/webhooks/asaas`. Esse endereço precisa ser **HTTPS público**, acessível pelo Asaas.

Para testar no seu computador, use um túnel:

1. `npx cloudflared tunnel --url http://localhost:3001` (use a porta do seu `npm run dev`).
2. No `.env.local`, defina `ASAAS_WEBHOOK_BASE_URL` com o endereço do túnel e reinicie o `npm run dev`.
3. Em **Configurações** → **Pagamentos**, (re)conecte a chave para o webhook apontar para o túnel.

Sem túnel, os pagamentos ainda são atualizados pela conferência diária (ou disparando-a à mão, como acima).

### 4. Nota fiscal (NFS-e)

Só para clínicas com **CNPJ**. A parte fiscal (inscrição municipal, certificado digital etc.) é configurada no **painel do Asaas**. No app, defina descrição, código do serviço (padrão 4.12), alíquota de ISS e, se quiser, **Emitir automaticamente ao receber**. Cada nota custa cerca de R$ 0,49 no Asaas. Dentista como pessoa física não é coberto (o livro-caixa e o Carnê-Leão têm seção própria, "Livro-caixa e Carnê-Leão", logo abaixo).

### Taxas e limites

- O Asaas cobra taxa por pagamento recebido; consulte a tabela oficial: <https://www.asaas.com/precos-e-taxas>.
- Máximo de 12 parcelas; mínimo de R$ 5,00 por parcela.
- Parcelas de cartão não podem ser marcadas como recebidas em dinheiro.
- Estornos são feitos no painel do Asaas.
- Cobranças criadas direto no painel do Asaas não são importadas para o app.

---

## Livro-caixa e Carnê-Leão

Controle de receitas e despesas do dentista que atende como pessoa física: despesas com comprovante, livro-caixa mensal, recibos do Receita Saúde e pacote para o contador.

### 1. Banco

No SQL Editor do Supabase, aplique [`supabase/2026-11-05-livro-caixa.sql`](supabase/2026-11-05-livro-caixa.sql) (pode rodar de novo sem problema). Ele cria as colunas novas de despesas e pacientes, a tabela de recibos e o bucket privado de comprovantes. Também torna privado o bucket `anneOdonto`: os documentos dos pacientes passam a abrir por link temporário.

### O que o app faz

- **Despesas** (Financeiro → Despesas): cadastro com categoria já classificada para o Carnê-Leão, data de pagamento e comprovante (foto pelo celular ou PDF, até 10 MB).
- **Livro-caixa** (Financeiro → Livro-caixa): por mês, receitas de pacientes, despesas dedutíveis, resultado do mês e alertas.
- **Recibos do Receita Saúde**: pagamentos de pacientes a emitir, com nome e CPF do pagador e do paciente, botões para copiar CPF e valor e marcação de "emitido" (com opção de desfazer).
- **Pacote do contador**: o botão "Baixar pacote do contador" gera um `.zip` com `resumo.pdf`, `lancamentos.csv` e a pasta `comprovantes/`. Se os comprovantes somarem mais de 100 MB, o zip sai sem a pasta, com um `LEIA-ME.txt` explicando.

### O que não faz

- Não calcula imposto.
- Não emite recibo no Receita Saúde. O recibo é emitido no app da Receita ou no Carnê-Leão Web; aqui você só marca como emitido.
- Não transmite nada à Receita.

> Valores para conferência. O cálculo oficial do imposto é feito no Carnê-Leão Web.

### Regras

- **Regime de caixa:** receita no mês em que foi recebida; despesa no mês em que foi paga.
- **Convênios ficam fora do Carnê-Leão:** o imposto é retido pela fonte pagadora. Não têm recibo no Receita Saúde e aparecem só como informação no livro-caixa.
- **Responsável pelo pagamento:** no cadastro do paciente, nome e CPF de quem paga (pai, mãe, responsável). Vazio = o próprio paciente. É esse CPF que vai no recibo.
- **Tarifas do Asaas:** entram como despesa "Tarifas de cobrança" (valor bruto menos valor líquido de cada pagamento), sem lançamento manual.
- **Confirmar com o contador** se as tarifas do Asaas podem ser deduzidas no Carnê-Leão.

---

## Funil de orçamentos e assinatura

Envio do orçamento pelo WhatsApp, aprovação e assinatura pelo paciente no celular, lembretes automáticos e acompanhamento do que foi fechado ou perdido.

### 1. Banco e endereço do app

1. No SQL Editor do Supabase, aplique [`supabase/2026-11-05-funil-orcamentos.sql`](supabase/2026-11-05-funil-orcamentos.sql) (pode rodar de novo sem problema).
2. O link do orçamento precisa ser um endereço que o celular do paciente alcance. Em produção, o `APP_URL` já serve. Em teste local, o `APP_URL` aponta para o Docker (`host.docker.internal`), então use um túnel, por exemplo `npx cloudflared tunnel --url http://localhost:3001`, e coloque o endereço gerado em `PUBLIC_APP_URL` (sem mexer no `APP_URL`). Reinicie o `npm run dev` depois.
3. Os lembretes rodam na rotina de mensagens que já existe (`/api/cron/messages`). A mesma rotina marca como vencidos os orçamentos fora da validade.

### O que o app faz

- **Envio pelo WhatsApp** com um link para o paciente.
- **Página do paciente:** ele escolhe os itens que quer, assina com nome e CPF, ou recusa.
- **Lembretes** nos dias 3 e 7 depois do envio (configuráveis em Mensagens).
- **Para ligar:** lista de orçamentos parados, com registro de cada contato.
- **Aprovação pela recepção**, quando o paciente decide fora do link.
- **Comprovante em PDF** da aprovação. O paciente pode baixar por 30 dias.
- **Página Orçamentos** com indicadores por período e por dentista.
- **Validade padrão** em Configurações → Clínica.
- **Gerar cobrança** com o valor aprovado.

### O que não faz

- Não usa provedor de assinatura. É assinatura eletrônica simples, aceita em contratos entre particulares (Lei 14.063/2020). Para prova mais forte, dá para adicionar depois um provedor como ZapSign ou Clicksign (não está nesta versão).
- Não conta orçamentos antigos nos números do funil: eles não têm data de envio.

### Regras

- **Orçamento aprovado fica travado.** Para mudar, crie outro.
- **Editar um orçamento enviado desativa o link.** Reenvie para o paciente.
- **5 CPFs errados** bloqueiam a assinatura daquele link por 1 hora.

---

## Evolução e anamnese por voz (IA)

Grave ou dite a evolução do atendimento e a anamnese; a IA organiza o texto e sugere as ações no sistema.

### 1. Banco e chave da OpenAI

1. No SQL Editor do Supabase, aplique [`supabase/2026-11-06-evolucao-por-voz.sql`](supabase/2026-11-06-evolucao-por-voz.sql).
2. Não há variável de ambiente nova: a chave é de cada clínica. Em Configurações → Inteligência artificial, cole a chave da OpenAI da clínica. Ela é testada antes de salvar e só os 4 últimos dígitos aparecem depois.
3. Escolha o modelo: **Econômico** (`gpt-6-luna`, padrão) ou **Mais caprichado** (`gpt-6.1-terra`). A mesma tela mostra o uso do mês com o custo estimado em dólar.
4. Uploads de áudio usam `experimental.proxyClientMaxBodySize: '26mb'` no `next.config.ts` (já configurado).

### O que o app faz

- **Evolução** (agenda → janela de evolução):
  - **Gravar:** transcreve com a OpenAI (`gpt-transcribe`), até 10 minutos. O áudio não é salvo.
  - **Ditar:** usa o reconhecimento de voz do navegador, sem custo.
  - **Organizar com IA:** devolve o texto em seções e sugestões já marcadas: concluir ou iniciar item de orçamento aprovado, atualizar tratamento, lançar tratamento novo no odontograma (valor R$ 0) e retorno que abre o agendamento.
  - **Salvar e aplicar N sugestões** grava tudo de uma vez.
- **Anamnese:** Gravar/Ditar e **Preencher com IA**, que preenche só as perguntas em branco; detalhes vão para Observações. Sem chave cadastrada, Ditar escreve direto em Observações.

### Custo estimado

- Transcrição: US$ 0,0045 por minuto.
- Uma evolução (3 min de áudio + organizar): cerca de US$ 0,015 no modelo econômico.

### LGPD

- São dados de saúde. A API da OpenAI não usa os dados enviados para treinar modelos.
- A clínica deve aceitar o DPA (acordo de processamento de dados) na conta dela na OpenAI.
- Recomendamos mencionar o uso de IA no termo de consentimento ou na política de privacidade da clínica.
- A ficha enviada à IA não leva nome, CPF nem telefone.

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
  lib/orcamentos/      regras do funil de orçamentos e assinatura
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
