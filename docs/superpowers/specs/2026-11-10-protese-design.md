# Prótese — design

Data: 2026-11-10. Branch: `feat/protese`. Fora do roteiro 0–9 (já concluído); pedido do usuário depois de verificar que a tela não estava funcional.

## Situação hoje

A tela `/protese` só **mostra** os cartões (que vêm do seed) e **move** entre as 4 colunas:

- "Nova solicitação" não tem ação — não há como criar prótese pelo app;
- não há edição nem exclusão;
- mover só troca `status`: nenhuma data registrada, e o erro do banco é ignorado (a tela mostra a mudança mesmo se falhou);
- a ficha do paciente carrega `prosthetics` e não exibe em lugar nenhum;
- nenhum aviso de atraso; o dentista é carregado e não aparece.

## Objetivo

Tornar a Prótese um controle real dos trabalhos de laboratório: cadastrar, acompanhar idas e voltas, ver atrasos, e levar o custo do laboratório ao Financeiro (e daí à comissão do dentista).

Sucesso: a recepção cria "Coroa cerâmica — dente 26 — Lab Dental Premium — R$ 350 — previsão 20/11" para um paciente; envia ao lab; o cartão fica vermelho com "Atrasada 2 dias" em 22/11; ao registrar o retorno aparece "Despesa de R$ 350,00 lançada no Financeiro (a pagar)" e a despesa está em Financeiro → Despesas, categoria "Laboratório de prótese", com o dentista; volta ao lab para ajuste ("2ª ida"), retorna sem gerar outra despesa, é instalada; a ficha do paciente, aba Próteses, mostra tudo com o histórico.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Escopo | Formulário criar/editar/excluir + datas e atraso + aba na ficha do paciente + custo do laboratório + cadastro de laboratórios |
| Despesa do laboratório | Criada **automaticamente no primeiro retorno**, como **"a pagar"**; o usuário marca como paga no Financeiro |
| Idas e voltas | **Histórico de etapas** (uma linha por mudança, com observação opcional) |
| Arquitetura | Função no banco (RPC) faz mudança de etapa + histórico + despesa numa transação; rotas da API como em Comissões/Convênios |

## Fora do escopo

Tabela de preços por laboratório, anexos/fotos, aviso por WhatsApp ao paciente ou ao laboratório, arrastar cartões, relatórios de prótese, ligação com tratamentos/orçamentos.

## Banco — `supabase/2026-11-10-protese.sql`

### `laboratories` (nova)

| coluna | tipo |
|---|---|
| `id` | UUID PK |
| `clinic_id` | UUID NOT NULL → clinics ON DELETE CASCADE |
| `name` | TEXT NOT NULL |
| `phone` | TEXT |
| `notes` | TEXT |
| `active` | BOOLEAN NOT NULL DEFAULT true |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |

- Índice único `(clinic_id, lower(btrim(name)))`.
- RLS `clinic_member` igual às outras tabelas com `clinic_id`.
- Sem exclusão pela interface (só desativar).

### `prosthetics` (colunas novas)

| coluna | tipo | obs. |
|---|---|---|
| `laboratory_id` | UUID → laboratories ON DELETE SET NULL | substitui o texto `laboratory`, que fica só para leitura de registros antigos |
| `tooth_region` | TEXT | "26", "arcada superior" |
| `lab_cost` | NUMERIC(10,2) CHECK (lab_cost IS NULL OR lab_cost >= 0) | opcional |
| `expense_id` | UUID → expenses ON DELETE SET NULL | despesa gerada |
| `expense_generated` | BOOLEAN NOT NULL DEFAULT false | true depois que a despesa foi criada uma vez — não recria se apagada no Financeiro |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

### `prosthetic_events` (nova)

| coluna | tipo |
|---|---|
| `id` | UUID PK |
| `clinic_id` | UUID NOT NULL → clinics ON DELETE CASCADE |
| `prosthetic_id` | UUID NOT NULL → prosthetics ON DELETE CASCADE |
| `from_status` | TEXT NULL (NULL = criação) |
| `to_status` | TEXT NOT NULL (mesmo CHECK de `prosthetics.status`) |
| `note` | TEXT |
| `created_by` | UUID NULL (auth user) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |

- Índice `(prosthetic_id, created_at)`; RLS `clinic_member`.

### Migração de dados

1. Para cada `(clinic_id, btrim(laboratory))` distinto e não vazio → um `laboratories`; preencher `prosthetics.laboratory_id`.
2. Para cada prótese existente → um evento `(NULL → status atual)` com `created_at = requested_at`.

O script é idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, só insere evento se a prótese não tiver nenhum).

### Funções (SECURITY DEFINER, chamadas pelo `admin` com `p_clinic_id` conferido)

**`create_prosthetic(p_clinic_id, p_user_id, p_data jsonb) → uuid`**
Insere a prótese com `status = 'requested'` e o evento de criação. Valida que paciente, dentista e laboratório são da clínica.

**`move_prosthetic(p_clinic_id, p_user_id, p_id, p_from, p_to, p_note, p_expected_at) → jsonb`**
Numa transação, com `SELECT … FOR UPDATE`:
1. prótese não existe na clínica → erro `nao_encontrada`;
2. `status <> p_from` → erro `conflito` (outra pessoa moveu);
3. `p_to = p_from` → erro `mesma_etapa`;
4. atualiza `status`, `updated_at` e, se `p_to = 'sent_to_lab'` e `p_expected_at` vier, `expected_at`;
5. insere o evento com `p_note`;
6. se `p_to IN ('returned','installed')` **e** `expense_generated = false` **e** `lab_cost > 0` → cria despesa e marca `expense_generated = true`, `expense_id`;
7. retorna `{ status, expense: { id, amount } | null }`.

**Despesa criada** (`expenses`):
- `description` = `Prótese: {tipo} — {paciente}` (+ ` — {laboratório}` se houver), cortado em 200 caracteres;
- `amount` = `lab_cost`;
- `category` = `'laboratorio'`, `deduction_group` = `'custeio'`;
- `professional_id` = dentista da prótese (a comissão já desconta laboratório **pago** com dentista);
- `status` = `'pending'`, `due_date` = data de hoje em `America/Sao_Paulo`, `paid_at` = NULL.

**`update_prosthetic(p_clinic_id, p_id, p_data jsonb) → jsonb`**
Atualiza os campos editáveis (paciente, dentista, laboratório, tipo, dente/região, previsão, custo, observação). Depois:
- se há `expense_id` e a despesa está `pending` → atualiza `amount` (custo) e `professional_id`; custo apagado ou zero → apaga a despesa pendente e zera `expense_id` (mantém `expense_generated = false` para poder gerar de novo);
- se a despesa está `paid` e custo/dentista mudaram → não mexe; retorna `aviso: 'despesa_paga'`;
- se não há despesa, `expense_generated = false`, status em `returned`/`installed` e custo > 0 → cria a despesa (mesma regra do mover).

Retorna `{ expense: {...} | null, aviso: 'despesa_paga' | null }`.

**`delete_prosthetic(p_clinic_id, p_id) → jsonb`**
Apaga a despesa ligada se estiver `pending`; despesa `paid` permanece. Apaga a prótese (eventos em cascata). Retorna `{ despesa: 'apagada' | 'mantida' | null }`.

## Regras puras — `src/lib/protese/`

- `etapas.ts`: `ETAPAS` (id, rótulo, cor — as mesmas 4 de hoje), `proximaEtapa(status)` (`requested→sent_to_lab→returned→installed`, `installed→null`), rótulo da ação principal ("Enviar ao lab", "Registrar retorno", "Instalar").
- `atraso.ts`: `diasDeAtraso(protese, hojeYmd)` → número > 0 só se status ∈ {`requested`, `sent_to_lab`}, há `expected_at` e `expected_at < hoje`; senão 0.
- `historico.ts`: `idasAoLab(eventos)` = número de eventos com `to_status = 'sent_to_lab'`; selo "Nª ida" quando ≥ 2.
- `validar.ts`: valida o corpo de criar/editar (paciente obrigatório; tipo até 80; dente/região até 40; observação até 1000; custo ≥ 0 com no máx. 2 casas; previsão `YYYY-MM-DD` válida; ids UUID) e de mover (status válidos, nota até 300). Mensagens em português.
- `repo.ts`: `createProteseRepo(admin)` — listar (com paciente, dentista, laboratório e eventos), chamar as RPCs e traduzir erros (`conflito` → 409, `nao_encontrada` → 404, `mesma_etapa` → 422).
- `laboratorios.ts`: validar nome (obrigatório, até 80) e telefone (até 30).

## API (`withClinic`, como Comissões)

| rota | método | faz |
|---|---|---|
| `/api/protese` | GET | lista da clínica; `?paciente=` filtra por paciente; `?instaladas=todas` traz instaladas antigas (padrão: instaladas nos últimos 30 dias pelo evento de instalação) |
| `/api/protese` | POST | cria |
| `/api/protese/[id]` | PATCH | edita |
| `/api/protese/[id]` | DELETE | exclui |
| `/api/protese/[id]/mover` | POST | `{ de, para, observacao?, previsao? }` |
| `/api/laboratorios` | GET, POST | lista (com nº de trabalhos em andamento) / cria |
| `/api/laboratorios/[id]` | PATCH | edita nome, telefone, observação, ativo |

Nome duplicado no laboratório → 409 "Já existe um laboratório com esse nome".

## Telas

### Quadro `/protese`

- Cabeçalho: título, filtros (dentista, laboratório, "Só atrasadas") e "Nova solicitação".
- 4 colunas como hoje; "Instalado" mostra os últimos 30 dias + link "Ver todas".
- **Cartão**: paciente; tipo + dente; laboratório; dentista; previsão; selo "2ª ida"; se atrasado, borda vermelha e "Atrasada N dia(s)". Clicar no cartão abre o formulário.
- Ações do cartão: botão da **próxima etapa** + menu "⋯" com as demais etapas (inclusive voltar). Escolher abre uma caixinha com observação opcional; para "Enviar ao lab" também a previsão de retorno (pré-preenchida). Confirmar chama `mover`.
- Sucesso com despesa → aviso "Despesa de R$ X lançada no Financeiro (a pagar)".
- Erro → cartão fica onde estava + mensagem; `409` → "Este trabalho foi atualizado por outra pessoa" e recarrega o quadro.

### Formulário (modal) — `src/components/protese/ModalProtese.tsx`

Campos: paciente (busca; travado quando aberto pela ficha), dentista, laboratório (lista ativa + "+ Novo laboratório" que cria só com o nome), tipo (texto com sugestões: Coroa, Coroa sobre implante, Faceta, Inlay/Onlay, PPR, Prótese total, Protocolo, Placa miorrelaxante, Provisório, Outro), dente/região, previsão de retorno, custo do laboratório (R$), observação.
Na edição: histórico (data, "de → para", observação, quem) e botão **Excluir** com confirmação que diz se a despesa pendente será apagada ou se a paga será mantida. Aviso `despesa_paga` mostrado após salvar.

### Ficha do paciente — aba "Próteses"

Nova aba em `pacientes/[id]` (`TabProteses.tsx`): lista com etapa (cor), tipo/dente, laboratório, previsão, atraso; botão "Nova prótese"; clicar abre o mesmo modal. Remove o carregamento morto de `prosthetics` da página.

### Configurações → Laboratórios

Card novo em `/configuracoes`; página `/configuracoes/laboratorios`: lista (nome, telefone, nº em andamento, ativo), adicionar/editar em linha ou modal, ativar/desativar.

Visual: tokens do novo layout (petróleo/gengiva/porcelana), sem cores Tailwind cruas.

## Testes

- `tests/protese/etapas.test.ts`, `atraso.test.ts`, `historico.test.ts`, `validar.test.ts`, `laboratorios.test.ts` — regras puras.
- `tests/protese/repo.test.ts` e rotas com o `fakeSupabase` existente: listar com filtros, criar, mover (sucesso, conflito 409, não encontrada 404), tradução de erros das RPCs, laboratório duplicado 409.
- A lógica das RPCs (despesa só uma vez, pendente atualizada, paga intocada, exclusão) é SQL: verificada no navegador contra o Supabase real.
- `tsc`, `eslint` nos arquivos mudados, vitest completo.
- Navegador (Playwright, login do usuário via variáveis de ambiente): criar prótese de teste com custo → enviar → atraso (previsão no passado) → retornar (despesa criada) → voltar ao lab → retornar (sem 2ª despesa) → instalar → ver na ficha e no Financeiro → excluir a prótese (despesa pendente some). Nada de teste fica no banco.

## Ordem de entrega

1. Migração SQL (o usuário roda no Supabase).
2. `lib/protese` + testes.
3. API + testes.
4. Laboratórios (config).
5. Modal + quadro.
6. Aba na ficha.
7. Verificação no navegador.
