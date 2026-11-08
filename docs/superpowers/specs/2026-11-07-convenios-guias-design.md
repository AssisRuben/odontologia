# Convênios — etapa 7a (operadoras, tabela, guias e lote do mês) — design

Item 7 do roteiro, primeira etapa. Data: 2026-11-07. Branch: `feat/convenios-guias`. A etapa 7b (pagamento, glosas, recurso e lançamento no financeiro) vem depois e parte do lote enviado.

## Objetivo

Organizar o faturamento de convênios odontológicos de um consultório que **digita as guias no portal de cada operadora**. O app não gera XML nem envia nada à operadora: ele guarda a tabela de cada operadora, controla as autorizações, monta o lote do mês e avisa o que está para vencer ou foi esquecido.

Sucesso: o dentista lança um tratamento de convênio escolhendo o procedimento da tabela da operadora (código TUSS e valor vêm sozinhos), cria a guia, registra a autorização por item, conclui o tratamento e, no fechamento, encontra o lote do mês pronto — com tudo que precisa digitar no portal, uma caixinha "digitado" por item e o prazo de envio. Nenhum procedimento concluído e autorizado fica fora de um lote sem aparecer nas pendências.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Envio à operadora | **Digitação no portal** pelo dentista. **Sem XML e sem webservice** |
| Divisão | **7a** = cadastros, tabela, guias/autorização, lote do mês; **7b** = pagamento, glosas, recurso, financeiro |
| Tabela | **Lista TUSS odontológica pronta** (oficial da ANS); o dentista escolhe o que a operadora cobre, digita o valor e marca "exige autorização"; pode acrescentar código que faltar |
| Origem dos itens | **Aba Tratamentos**: o procedimento de convênio é escolhido da tabela da operadora; a guia junta tratamentos |
| Autorização | **Por item**: a guia guarda número, senha e validade; cada item fica autorizado ou negado (com motivo) |
| Estrutura | **Guia com itens próprios** ligados ao tratamento, com código, nome, dentes e valor **copiados** no momento da guia |

## Fora do escopo (7a)

XML TISS, webservice, impressão da GTO no modelo oficial, anexos (radiografias/fotos), importação de planilha de valores, reajuste em massa, copiar tabela entre operadoras, mais de um convênio por paciente, guia de urgência sem tratamento, pagamento/glosas (7b).

## Banco (`supabase/2026-11-07-convenios-guias.sql`, espelhado em `schema.sql`)

Todos os `ALTER`/`CREATE` com `IF NOT EXISTS` (o script pode rodar mais de uma vez).

### Colunas novas

- `insurance_plans` (operadora):
  - `ans_registry TEXT` — registro ANS, 6 dígitos (`CHECK (ans_registry ~ '^\d{6}$')` quando não nulo).
  - `provider_code TEXT` — código do prestador na operadora (até 30 caracteres).
  - `closing_day SMALLINT` — dia de fechamento do lote, `CHECK (closing_day BETWEEN 1 AND 28)`; nulo = lote não se monta.
  - `submission_days SMALLINT NOT NULL DEFAULT 10` — prazo de envio em dias após o fechamento, `CHECK (submission_days BETWEEN 0 AND 90)`.
  - `active BOOLEAN NOT NULL DEFAULT TRUE`.
- `patients`: `insurance_card TEXT` (até 30 caracteres), `insurance_card_valid_until DATE`.
- `treatments`:
  - `insurance_procedure_id UUID REFERENCES insurance_plan_procedures(id) ON DELETE SET NULL`.
  - `completed_at DATE` — preenchida por trigger: ao passar para `completed`, recebe `COALESCE(completed_at, CURRENT_DATE)`; ao sair de `completed`, volta a nulo.

### Tabelas novas

- `tuss_procedures` — lista TUSS odontológica, igual para todas as clínicas: `code TEXT PRIMARY KEY` (8 dígitos), `name TEXT NOT NULL`. Leitura para `authenticated`; sem escrita pelo app. Carga em script separado `supabase/2026-11-07-tuss-odontologia.sql` (`INSERT ... ON CONFLICT (code) DO UPDATE SET name`), gerado a partir da **Tabela 22 (Procedimentos e eventos em saúde) do Padrão TISS da ANS, versão 202609**, filtrando os procedimentos odontológicos. O plano fixa o filtro e o script gerador.
- `insurance_plan_procedures` — tabela da operadora: `id`, `clinic_id`, `insurance_plan_id` (`ON DELETE CASCADE`), `code TEXT NOT NULL` (1–20 caracteres), `name TEXT NOT NULL`, `value NUMERIC(10,2) NOT NULL CHECK (value >= 0)`, `requires_authorization BOOLEAN NOT NULL DEFAULT FALSE`, `active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at`; `UNIQUE (insurance_plan_id, code)`.
- `insurance_guides` — guia: `id`, `clinic_id`, `patient_id`, `insurance_plan_id`, `professional_id` (executante), `status TEXT NOT NULL CHECK (status IN ('aguardando','liberada','cancelada'))`, `guide_number TEXT`, `password TEXT`, `password_valid_until DATE`, `insurance_card TEXT` (cópia da carteirinha), `requested_at DATE NOT NULL DEFAULT CURRENT_DATE`, `responded_at TIMESTAMPTZ`, `notes TEXT`, `created_at`.
- `insurance_guide_items` — item da guia: `id`, `clinic_id`, `guide_id` (`ON DELETE CASCADE`), `treatment_id UUID REFERENCES treatments(id) ON DELETE SET NULL`, `code`, `name`, `teeth JSONB NOT NULL DEFAULT '[]'` (`[{ tooth, faces[] }]`, cópia de `treatment_teeth`), `value NUMERIC(10,2)`, `requires_authorization BOOLEAN`, `authorization TEXT NOT NULL CHECK (authorization IN ('pendente','autorizado','negado','nao_exige'))`, `denial_reason TEXT`, `active BOOLEAN NOT NULL DEFAULT TRUE`, `executed_at DATE`, `batch_id UUID REFERENCES insurance_batches(id) ON DELETE SET NULL`, `defer_until DATE`, `typed BOOLEAN NOT NULL DEFAULT FALSE`, `created_at`.
  - **Um tratamento em uma guia ativa por vez:** `CREATE UNIQUE INDEX ... ON insurance_guide_items (treatment_id) WHERE active`.
  - `active` vira `false` quando o item é negado ou a guia é cancelada.
- `insurance_batches` — lote: `id`, `clinic_id`, `insurance_plan_id`, `period_start DATE`, `period_end DATE` (dia de fechamento), `due_date DATE` (`period_end + submission_days`), `status TEXT NOT NULL CHECK (status IN ('aberto','enviado'))`, `protocol TEXT`, `sent_at DATE`, `created_at`; `UNIQUE (insurance_plan_id, period_end)`.
  - **Um item em um lote por vez:** garantido pela coluna única `batch_id`.

### Acesso (RLS)

- `tuss_procedures`: `SELECT` para `authenticated`.
- `insurance_plan_procedures`: política `clinic_member` `FOR ALL` (editada pela tela de configurações, como `insurance_plans`).
- `insurance_guides`, `insurance_guide_items`, `insurance_batches`: só `SELECT` para membros da clínica; **toda escrita pelo servidor** (service role), em rotas que validam as regras.

## Regras de negócio (`src/lib/convenios/`, funções puras e testáveis)

| Arquivo | Responsabilidade |
|---|---|
| `cadastro.ts` | Validar/normalizar operadora (registro ANS, código do prestador, fechamento, prazo), item da tabela (código, nome, valor) e carteirinha |
| `periodo.ts` | `periodoDe(data, closingDay)` → `{ start, end }` (o fechamento é o primeiro dia `closingDay` ≥ data; o início é o dia seguinte ao fechamento anterior); `prazo(end, submissionDays)` |
| `guias.ts` | Validar a criação da guia (tratamentos do mesmo paciente e operadora, com procedimento da tabela, sem guia ativa, não cancelados); montar os itens copiados; estado inicial (`liberada` com itens `nao_exige` quando nenhum exige autorização; senão `aguardando` com itens `pendente`/`nao_exige`); validar a resposta (só itens da guia; negado exige motivo; senha com validade opcional) |
| `prontidao.ts` | `itemPronto(item, tratamento)` = item ativo, autorização `autorizado` ou `nao_exige`, tratamento `completed`, sem lote; data de execução = `executed_at ?? completed_at` |
| `lotes.ts` | Escolher o lote de destino de cada item pronto: período do item (pela data de execução, adiado por `defer_until`); se o lote desse período já foi enviado, vai para o primeiro lote **aberto** seguinte; itens com execução antes do início do lote ficam marcados "atrasado" |
| `divergencia.ts` | Comparar item × tratamento atual (código, valor, dentes/faces) |
| `pendencias.ts` | Montar a lista de pendências e o número do contador do menu |

### Pendências (aba e contador)

1. Guias `aguardando` há mais de **7 dias**.
2. Senhas que vencem em até **7 dias** (ou vencidas) com itens ainda sem lote.
3. Tratamentos de convênio **concluídos** sem guia ativa, com item `pendente`, ou fora da tabela.
4. Lotes `aberto` com prazo em até **3 dias** ou vencido.
5. Operadora com tratamentos de convênio e sem dia de fechamento.

O contador do link "Convênios" no menu soma os itens 3 e 4.

## Rotas (todas com `withClinic`, respostas `{ error }` em português)

| Rota | Faz |
|---|---|
| `POST /api/guias` | Cria a guia a partir de `{ patientId, insurancePlanId, professionalId, treatmentIds[] }` |
| `POST /api/guias/[id]/resposta` | Registra `{ guideNumber, password, passwordValidUntil, itens: [{ id, authorization: 'autorizado'\|'negado', denialReason }] }`; permitido enquanto nenhum item da guia estiver em lote |
| `POST /api/guias/[id]/cancelar` | Cancela a guia (itens `active = false`); recusado se algum item estiver em lote |
| `POST /api/guias/itens/[id]/atualizar` | Copia de novo os dados do tratamento para o item (divergência); recusado se o item estiver em lote |
| `PATCH /api/guias/itens/[id]` | Corrige `executed_at` |
| `GET /api/convenios/pendencias` | Lista de pendências + contador |
| `GET /api/convenios/lotes` | Monta/atualiza os lotes abertos (idempotente) e devolve lotes com itens |
| `PATCH /api/convenios/lotes/[id]/itens/[itemId]` | `{ typed }` ou `{ remover: true }` (tira do lote e adia para o período seguinte via `defer_until`); só em lote `aberto` |
| `POST /api/convenios/lotes/[id]/enviar` | `{ protocol, sentAt }`; recusado se o lote estiver vazio ou já enviado; depois de enviado, o lote fica travado |

A montagem dos lotes e o envio rodam numa função SQL `SECURITY DEFINER` com `pg_advisory_xact_lock(hashtext(insurance_plan_id))`, para que dois usuários montando ou enviando o mesmo lote ao mesmo tempo não dupliquem nem percam itens.

## Telas

- **Configurações → Convênios** (já existe): cada operadora abre um painel com os campos novos e a **tabela**: busca na lista TUSS por código ou nome, adiciona com valor e "exige autorização", edita, desativa; "código fora da lista" permite digitar código e nome.
- **Cadastro do paciente**: carteirinha e validade, abaixo do convênio.
- **Aba Tratamentos**: com convênio escolhido, o procedimento vira busca na tabela da operadora (código e valor preenchidos; valor editável); tratamento de convênio sem item da tabela mostra "fora da tabela". Cada tratamento mostra o selo da guia (aguardando / autorizado / negado / em lote).
- **Paciente → seção "Guias"**: lista de guias com itens e status; "Criar guia" (marca tratamentos, escolhe executante, avisa carteirinha vencida/vazia); "Registrar resposta"; "Cancelar guia"; selo "diferente do tratamento" com botão "Atualizar item".
- **Nova tela `/convenios`** no menu (com contador): abas **Pendências** e **Lotes**. Lote: operadora, período, prazo (dias restantes), itens agrupados por paciente/guia (carteirinha, nº da guia, senha, código, dentes/faces, data, valor), caixinha "digitado", "Tirar do lote", total, **Imprimir** (impressão do navegador) e **Marcar como enviado** (protocolo + data).

## Erros tratados

- Guia com tratamento de outro paciente/operadora, fora da tabela, cancelado ou já em guia ativa → 422 com a mensagem.
- Resposta com item que não é da guia, negado sem motivo, guia cancelada ou com item em lote → 422/409.
- Lote vazio ou já enviado ao marcar envio; mexer em item de lote enviado → 409.
- Operadora sem dia de fechamento → o lote não se monta e a pendência pede para completar o cadastro.
- Tratamento apagado depois da guia → o item continua (histórico) com `treatment_id` nulo e não fica pronto sozinho; aparece nas pendências da guia.

## Testes

- Unitários para `cadastro`, `periodo` (inclusive virada de ano e fechamento no dia 28), `guias`, `prontidao`, `lotes` (destino, atrasado, adiado, lote enviado), `divergencia` e `pendencias`.
- Rotas com `tests/fakeSupabase.ts`: criação de guia, resposta, cancelamento, atualização de item, montagem/envio de lote, conflitos.
- Teste manual do usuário no fim.

## Documentação

README ganha a seção **"Convênios"**: como cadastrar a operadora e a tabela, criar guia, registrar autorização, fechar e enviar o lote, e os scripts SQL a rodar.
